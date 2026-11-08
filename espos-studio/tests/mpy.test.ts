import { expect, test, mock, beforeEach } from "bun:test";
import { createHash } from "node:crypto";

/** Minimal MicroPython REPL that understands the code mpy.ts sends. */
class FakeBoard {
  mode: "friendly" | "raw" = "friendly";
  files = new Map<string, Uint8Array>();
  friendlyLines: string[] = [];
  opened: string[] = [];
  corrupt = false;
  /** Simulates a filesystem that refuses to rename over an existing file (FAT). */
  renameFails = false;
  removed: string[] = [];
  rebootAtChunk = -1;
  softReboots = 0;
  modeAtSoftReboot: string[] = [];
  private pending = "";
  private openPath = "";
  private parts: Uint8Array[] = [];
  private chunks = 0;
  listeners = new Set<(c: Uint8Array) => void>();

  emit(text: string) { const bytes = new TextEncoder().encode(text); for (const fn of this.listeners) fn(bytes); }
  /** Hardware reset: ROM log, then main.py and the friendly REPL. */
  reboot(silent = false, split = false) {
    this.mode = "friendly"; this.pending = "";
    if (silent) return;
    const banner = "\r\nESP-ROM:esp32s3-20210327\r\nrst:0x1 (POWERON),boot:0x8\r\nespOS: ready / headless / USB\r\n>>> ";
    if (split) { this.emit(banner.slice(0, 5)); this.emit(banner.slice(5, 22)); this.emit(banner.slice(22)); } else this.emit(banner);
  }
  write(data: string) {
    for (const ch of data) {
      if (ch === "\x01") { this.mode = "raw"; this.pending = ""; this.emit("raw REPL; CTRL-B to exit\r\n>"); }
      else if (ch === "\x02") { this.mode = "friendly"; this.pending = ""; this.emit("\r\nMicroPython v1.29.0\r\n>>> "); }
      else if (ch === "\x03") { this.pending = ""; }
      else if (ch === "\x04") {
        if (this.mode === "raw" && this.pending) this.execRaw(this.pending);
        else { this.softReboots++; this.modeAtSoftReboot.push(this.mode); this.mode = "friendly"; this.emit("MPY: soft reboot\r\n>>> "); }
        this.pending = "";
      } else if (ch === "\n" && this.mode === "friendly") { this.friendlyLines.push(this.pending); this.pending = ""; }
      else this.pending += ch;
    }
  }
  private reply(stdout = "", stderr = "") { this.emit("OK" + stdout + "\x04" + stderr + "\x04>"); }
  private execRaw(code: string) {
    const open = /_f = open\((".*?"), 'wb'\)/.exec(code);
    if (open) { this.openPath = JSON.parse(open[1]!); this.opened.push(this.openPath); this.parts = []; return this.reply(); }
    const chunk = /_w\(ubinascii\.a2b_base64\((".*?")\)\)/.exec(code);
    if (chunk) {
      if (++this.chunks === this.rebootAtChunk) return this.reboot(false, true);
      const bytes = Uint8Array.from(Buffer.from(JSON.parse(chunk[1]!), "base64"));
      if (this.corrupt) bytes[0] = bytes[0]! ^ 1;
      this.parts.push(bytes); return this.reply();
    }
    if (code.includes("_h = hashlib.sha256()")) {
      const path = JSON.parse(/open\((".*?"), 'rb'\)/.exec(code)![1]!);
      return this.reply(createHash("sha256").update(this.files.get(path) ?? new Uint8Array()).digest("hex") + "\r\n");
    }
    if (code.includes("os.rename(")) {
      const [, tmp, target] = /os\.rename\((".*?"), (".*?")\)/.exec(code)!;
      if (this.renameFails && this.files.has(JSON.parse(target!))) {
        return this.reply("", "Traceback (most recent call last):\r\nOSError: [Errno 17] EEXIST\r\n");
      }
      this.files.set(JSON.parse(target!), this.files.get(JSON.parse(tmp!))!); this.files.delete(JSON.parse(tmp!)); return this.reply();
    }
    if (code.includes("os.remove(")) { this.removed.push(JSON.parse(/os\.remove\((".*?")\)/.exec(code)![1]!)); this.files.delete(JSON.parse(/os\.remove\((".*?")\)/.exec(code)![1]!)); return this.reply(); }
    if (code === "_f.close()") { this.files.set(this.openPath, Buffer.concat(this.parts)); return this.reply(); }
    if (code.includes("raise")) return this.reply("", "Traceback (most recent call last):\r\nValueError: boom\r\n");
    if (code.includes("print(1)")) return this.reply("1\r\n");
    return this.reply(); // makeDirs and other housekeeping
  }
}

let board = new FakeBoard();
mock.module("../packages/web/src/web/lib/serial", () => ({ serial: {
  async write(data: string | Uint8Array) { board.write(typeof data === "string" ? data : new TextDecoder().decode(data)); },
  onData(fn: (c: Uint8Array) => void) { board.listeners.add(fn); return () => board.listeners.delete(fn); },
} }));
const { mpy, DeviceResetError, DeviceError } = await import("../packages/web/src/web/lib/mpy");
const bytes = (s: string) => new TextEncoder().encode(s);

beforeEach(() => { mpy.detach(); const listeners = board.listeners; board = new FakeBoard(); board.listeners = listeners; });

test("file is written to a temp sibling, verified by SHA-256 and renamed", async () => {
  await mpy.writeFile("/apps/hello/app.py", "print('Привет')\n");
  expect(board.opened).toEqual(["/apps/hello/app.py.espos-tmp"]);
  expect(board.files.get("/apps/hello/app.py")).toEqual(bytes("print('Привет')\n"));
  expect(board.files.has("/apps/hello/app.py.espos-tmp")).toBe(false);
});

test("board reset behind Studio's back never receives code in the friendly REPL", async () => {
  board.files.set("/main.py", bytes("original"));
  expect(await mpy.exec("print(1)")).toContain("1"); // Studio now believes raw REPL
  for (const silent of [false, true]) { // with and without a visible boot log
    board.reboot(silent);
    await mpy.writeFile("/main.py", "updated " + silent);
    expect(board.friendlyLines.some(l => l.includes("open("))).toBe(false);
    expect(board.softReboots).toBe(0); // no stray Ctrl-D in the friendly REPL
    expect(board.files.get("/main.py")).toEqual(bytes("updated " + silent));
  }
});

test("hash mismatch keeps the original file and removes the temp file", async () => {
  board.files.set("/config.py", bytes("old"));
  board.corrupt = true;
  await expect(mpy.writeFile("/config.py", "new")).rejects.toThrow("SHA-256");
  expect(board.files.get("/config.py")).toEqual(bytes("old"));
  expect(board.files.has("/config.py.espos-tmp")).toBe(false);
});

test("reboot during a write aborts it, keeps the original and recovers", async () => {
  board.files.set("/boot.py", bytes("old boot"));
  board.rebootAtChunk = 2;
  await expect(mpy.writeFile("/boot.py", "x".repeat(2000))).rejects.toBeInstanceOf(DeviceResetError);
  expect(board.files.get("/boot.py")).toEqual(bytes("old boot"));
  expect(board.friendlyLines.some(l => l.includes("_w(") || l.includes("open("))).toBe(false);
  await mpy.exitRaw(); // board is already friendly: no Ctrl-B banner noise
  expect(board.mode).toBe("friendly");
  board.rebootAtChunk = -1;
  await mpy.writeFile("/boot.py", "new boot");
  expect(board.files.get("/boot.py")).toEqual(bytes("new boot"));
});

test("soft reset after a device error leaves raw REPL first so main.py runs", async () => {
  await expect(mpy.exec("raise ValueError('boom')")).rejects.toThrow("boom");
  await mpy.softReset();
  expect(board.modeAtSoftReboot).toEqual(["friendly"]);
});

test("failed rename never deletes the original and keeps the verified temp", async () => {
  board.files.set("/config.py", bytes("old"));
  board.renameFails = true;
  const err = await mpy.writeFile("/config.py", "new").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(DeviceError);
  expect(String((err as Error).message)).toContain("/config.py.espos-tmp");
  expect(board.files.get("/config.py")).toEqual(bytes("old"));
  expect(board.files.get("/config.py.espos-tmp")).toEqual(bytes("new"));
  expect(board.removed).toEqual([]); // neither target nor verified temp
  // The REPL is still usable and a later write to a fresh path succeeds.
  board.renameFails = false;
  await mpy.writeFile("/apps/new.py", "ok");
  expect(board.files.get("/apps/new.py")).toEqual(bytes("ok"));
});
