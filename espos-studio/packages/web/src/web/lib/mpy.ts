/**
 * MicroPython raw-REPL client over WebSerial — the same protocol `mpremote`
 * speaks, reimplemented for the browser.
 *
 *   Ctrl-C Ctrl-C  interrupt whatever is running
 *   Ctrl-A         enter raw REPL   -> "raw REPL; CTRL-B to exit\r\n>"
 *   <code> Ctrl-D  submit          -> "OK" <stdout> \x04 <stderr> \x04 ">"
 *   Ctrl-B         back to the friendly REPL
 *   Ctrl-D         soft reset
 *
 * Globals survive between submissions, which is what makes chunked file
 * writes possible (open once, write many, close).
 *
 * Every operation re-enters raw REPL first (Ctrl-A also resets an already
 * raw REPL), so a board that rebooted behind our back — RST on a USB-UART
 * board keeps the port open — never receives code in the friendly REPL.
 * A reboot seen mid-operation aborts it.
 */

import { serial } from "./serial";

const CTRL_A = "\x01";
const CTRL_B = "\x02";
const CTRL_C = "\x03";
const CTRL_D = "\x04";
const RAW_BANNER = "raw REPL; CTRL-B to exit\r\n";
/** Boot output meaning the board restarted into the friendly REPL / main.py. */
const RESET_MARKERS = ["rst:0x", "ESP-ROM:", "MPY: soft reboot"];
const TAIL = 16; // > longest marker, so markers split across chunks are found once

function bytesToLatin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class DeviceBusyError extends Error {}
/** The board printed a reset/boot banner while an operation was running. */
export class DeviceResetError extends Error {}
/** Python on the board raised; the raw REPL itself is still in sync. */
export class DeviceError extends Error {}

type ReplState = "friendly" | "raw" | "unknown";

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

class MicroPython {
  private buffer = "";
  private unsubscribe: (() => void) | null = null;
  private state: ReplState = "friendly";
  private resets = 0;
  private tail = "";
  /** Reset count when the current operation entered raw REPL; null when idle. */
  private opResets: number | null = null;
  private lock: Promise<unknown> = Promise.resolve();

  /** Serialize device access — two callers can never interleave submissions. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const guarded = async () => {
      try {
        return await fn();
      } catch (e) {
        // After a timeout we no longer know which REPL the board is in.
        if (!(e instanceof DeviceResetError)) this.state = "unknown";
        throw e;
      } finally {
        this.opResets = null;
      }
    };
    const next = this.lock.then(guarded, guarded) as Promise<T>;
    this.lock = next.catch(() => undefined);
    return next;
  }

  private attach() {
    if (this.unsubscribe) return;
    this.unsubscribe = serial.onData((chunk) => {
      const text = bytesToLatin1(chunk);
      this.noteResets(text);
      this.buffer += text;
      if (this.buffer.length > 1_000_000) this.buffer = this.buffer.slice(-200_000);
    });
  }

  private noteResets(text: string) {
    const scan = this.tail + text;
    for (const marker of RESET_MARKERS) {
      // Matches lying entirely inside the old tail were counted last time.
      let i = scan.indexOf(marker, Math.max(0, this.tail.length - marker.length + 1));
      while (i >= 0) {
        this.resets++;
        this.state = "friendly";
        i = scan.indexOf(marker, i + marker.length);
      }
    }
    this.tail = scan.slice(-TAIL);
  }

  detach() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.state = "friendly";
    this.buffer = "";
    this.tail = "";
    this.opResets = null;
  }

  private async readUntil(token: string, timeoutMs = 8000): Promise<string> {
    const start = Date.now();
    for (;;) {
      if (this.opResets !== null && this.resets !== this.opResets) {
        throw new DeviceResetError("Плата перезагрузилась во время операции — действие прервано и не повторяется. Проверь файл и повтори вручную.");
      }
      const idx = this.buffer.indexOf(token);
      if (idx >= 0) {
        const out = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + token.length);
        return out;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timed out waiting for ${JSON.stringify(token)} from the device`);
      }
      await new Promise((r) => setTimeout(r, 15));
    }
  }

  /** Fresh raw-REPL handshake; never trusts a cached mode. */
  private async enterRaw(): Promise<void> {
    this.attach();
    await serial.write(CTRL_C + CTRL_C);
    await new Promise((r) => setTimeout(r, 80));
    this.buffer = "";
    await serial.write(CTRL_A);
    await this.readUntil(RAW_BANNER, 5000);
    this.state = "raw";
    this.opResets = this.resets;
  }

  async exitRaw(): Promise<void> {
    if (this.state === "friendly") return;
    await serial.write(CTRL_B);
    this.state = "friendly";
    this.buffer = "";
  }

  /** Submit one chunk of Python and return its stdout. Raises on device traceback. */
  private async submit(code: string, timeoutMs = 15000): Promise<string> {
    await serial.write(code + CTRL_D);
    const ack = await this.readUntil("OK", 5000);
    if (ack.includes("Traceback")) throw new Error(ack.trim());
    const stdout = await this.readUntil(CTRL_D, timeoutMs);
    const stderr = await this.readUntil(CTRL_D, timeoutMs);
    await this.readUntil(">", 5000);
    if (stderr.trim()) throw new DeviceError(stderr.trim());
    return stdout;
  }

  /** Run Python on the device and get stdout back. */
  exec(code: string, timeoutMs = 15000): Promise<string> {
    return this.run(async () => {
      await this.enterRaw();
      return this.submit(code, timeoutMs);
    });
  }

  async listDir(path = "/"): Promise<DirEntry[]> {
    const code = [
      "import os, json",
      `_p = ${JSON.stringify(path)}`,
      "_out = []",
      "for _e in os.listdir(_p):",
      "    _fp = (_p.rstrip('/') + '/' + _e)",
      "    try:",
      "        _st = os.stat(_fp)",
      "    except OSError:",
      "        _st = (0, 0, 0, 0, 0, 0, 0)",
      "    _out.append({'name': _e, 'path': _fp, 'isDir': bool(_st[0] & 0x4000), 'size': _st[6]})",
      "print(json.dumps(_out))",
    ].join("\n");
    const out = await this.exec(code);
    const json = out.trim().split("\n").pop() ?? "[]";
    return JSON.parse(json) as DirEntry[];
  }

  async readFile(path: string): Promise<string> {
    const code = [
      "import ubinascii",
      `_f = open(${JSON.stringify(path)}, 'rb')`,
      "while True:",
      "    _b = _f.read(512)",
      "    if not _b:",
      "        break",
      "    print(ubinascii.b2a_base64(_b).decode().strip())",
      "_f.close()",
    ].join("\n");
    const out = await this.exec(code, 30000);
    const b64 = out.replace(/\s+/g, "");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async makeDirs(path: string): Promise<void> {
    const code = [
      "import os",
      `_parts = ${JSON.stringify(path)}.strip('/').split('/')`,
      "_cur = ''",
      "for _p in _parts:",
      "    _cur = _cur + '/' + _p",
      "    try:",
      "        os.mkdir(_cur)",
      "    except OSError:",
      "        pass",
    ].join("\n");
    await this.exec(code);
  }

  /**
   * Writes a sibling temp file, re-reads it from flash and compares SHA-256,
   * and only then renames it over `path`. The original is never deleted by
   * Studio: a lost USB link, reboot, hash mismatch or failed rename stops the
   * write before `path` is touched (at worst a `.espos-tmp` remains). A rename
   * error keeps the verified temp so it can be inspected or renamed by hand.
   * This is fail-closed error handling, not a power-loss atomicity guarantee.
   */
  async writeFile(path: string, content: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    const bytes = new TextEncoder().encode(content);
    const expected = await sha256Hex(bytes);
    const chunkSize = 384; // keeps each submission comfortably small for the device
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (dir) await this.makeDirs(dir);
    const target = JSON.stringify(path);
    const tmp = JSON.stringify(path + ".espos-tmp");

    await this.run(async () => {
      await this.enterRaw();
      let verified = false;
      try {
        await this.submit(`import ubinascii, hashlib, os\n_f = open(${tmp}, 'wb')\n_w = _f.write`);
        for (let off = 0; off < bytes.length; off += chunkSize) {
          const slice = bytes.subarray(off, off + chunkSize);
          let bin = "";
          for (let i = 0; i < slice.length; i++) bin += String.fromCharCode(slice[i]!);
          const b64 = btoa(bin);
          await this.submit(`_w(ubinascii.a2b_base64(${JSON.stringify(b64)}))`);
          onProgress?.(Math.min(off + chunkSize, bytes.length), bytes.length);
        }
        await this.submit("_f.close()");
        const verify = [
          "_h = hashlib.sha256()",
          `with open(${tmp}, 'rb') as _r:`,
          "    while True:",
          "        _b = _r.read(512)",
          "        if not _b:",
          "            break",
          "        _h.update(_b)",
          "print(ubinascii.hexlify(_h.digest()).decode())",
        ].join("\n");
        const actual = (await this.submit(verify)).trim().split("\n").pop()?.trim();
        if (actual !== expected) {
          throw new DeviceError(`Проверка записи ${path} не прошла: SHA-256 на плате не совпал. Исходный файл не изменён.`);
        }
        verified = true;
        // LittleFS (ESP32 default) renames over an existing file. There is
        // deliberately no remove-then-rename fallback: if rename refuses (e.g.
        // FAT), deleting the original first could lose both copies.
        try {
          await this.submit(`os.rename(${tmp}, ${target})`);
        } catch (e) {
          if (e instanceof DeviceError) {
            throw new DeviceError(
              `Не удалось заменить ${path}: ${e.message}. Studio не удалял исходный файл; ` +
                `проверенная новая версия оставлена в ${path}.espos-tmp. Автоматический повтор не выполняется.`,
            );
          }
          throw e;
        }
        try {
          await this.submit("if hasattr(os, 'sync'):\n    os.sync()");
        } catch (e) {
          if (e instanceof DeviceError) {
            throw new DeviceError(`${path} переименован, но os.sync() сообщил ошибку: ${e.message}. Перечитай файл перед продолжением.`);
          }
          throw e;
        }
      } catch (e) {
        // The raw REPL is still in sync only after a Python-side error. Once
        // the temp is verified it is never deleted: it may be the only copy.
        if (e instanceof DeviceError && !verified) {
          await this.submit(`try:\n    _f.close()\nexcept Exception:\n    pass\ntry:\n    os.remove(${tmp})\nexcept OSError:\n    pass`).catch(() => undefined);
        }
        throw e;
      }
      if (bytes.length === 0) onProgress?.(0, 0);
    });
  }

  async remove(path: string, isDir = false): Promise<void> {
    const code = isDir
      ? `import os\nos.rmdir(${JSON.stringify(path)})`
      : `import os\nos.remove(${JSON.stringify(path)})`;
    await this.exec(code);
  }

  async deviceInfo(): Promise<{ platform: string; version: string; freqMhz: number; freeMem: number; fsFreeKb: number }> {
    const code = [
      "import sys, os, gc, machine, json",
      "gc.collect()",
      "_s = os.statvfs('/')",
      "print(json.dumps({",
      "  'platform': sys.platform,",
      "  'version': sys.version,",
      "  'freqMhz': machine.freq() // 1000000,",
      "  'freeMem': gc.mem_free(),",
      "  'fsFreeKb': (_s[0] * _s[3]) // 1024,",
      "}))",
    ].join("\n");
    const out = await this.exec(code);
    return JSON.parse(out.trim().split("\n").pop() ?? "{}");
  }

  /** Soft reset — leaves raw REPL (also when its state is unknown) and reruns boot.py/main.py. */
  async softReset(): Promise<void> {
    await this.run(async () => {
      await this.exitRaw();
      await serial.write(CTRL_D);
    });
  }

  async interrupt(): Promise<void> {
    await serial.write(CTRL_C);
  }
}

export const mpy = new MicroPython();
