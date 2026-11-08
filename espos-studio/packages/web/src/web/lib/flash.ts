/**
 * esptool-js wrapper: probes ESP32 families and writes full MicroPython images over WebSerial.
 * The serial manager's reader/writer are released first, since esptool-js needs
 * the raw port, and re-acquired when flashing finishes.
 */

import { ESPLoader, Transport } from "esptool-js";
import { serial } from "./serial";
import { mpy } from "./mpy";
import type { EventSink } from "./flash-diagnostics";
import { assertChipMatches, boardFromChipName, validateImage, type BoardId, type BoardProfile } from "../../shared/boards";

export interface FlashProgress {
  phase: "connecting" | "erasing" | "writing" | "done";
  written: number;
  total: number;
  message: string;
}

export async function fetchFirmware(url: string, onProgress?: (loaded: number, total: number) => void): Promise<Uint8Array> {
  const res = await fetch(`/api/firmware/download?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  if (!res.body) return new Uint8Array(await res.arrayBuffer());

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      onProgress?.(loaded, total);
    }
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export interface DetectedChip {
  name: string;
  board: BoardId | null;
}
let ownsPort = false;

/** esptool opens the port itself: releasing stream locks alone is insufficient. */
async function withLoader<T>(onLog: (line: string) => void, fn: (loader: ESPLoader) => Promise<T>, onEvent?: EventSink): Promise<T> {
  if (ownsPort) throw new Error("USB-транспорт уже занят.");
  const port = serial.port;
  if (!port) throw new Error("Сначала подключи устройство.");
  ownsPort = true;
  let transport: Transport | undefined;
  try {
    onEvent?.({ stage: "port", message: "Освобождение потоков и передача порта esptool" });
    transport = new Transport(port, false);
    const loader = new ESPLoader({
      transport, baudrate: 115200, romBaudrate: 115200,
      terminal: { clean: () => undefined, write: onLog, writeLine: (s) => onLog(s + "\n") },
    });
    mpy.detach();
    await serial.releaseStreams();
    await port.close();
    return await fn(loader);
  } finally {
    try {
      try { await transport?.disconnect(); } catch { /* may already be detached */ }
      onEvent?.({ stage: "reconnect", message: "Возврат порта Studio; без повторной записи" });
      try {
        await serial.reopen(115200);
      } catch (e) {
        try { await serial.disconnect(); } catch { /* preserve original operation result */ }
        const message = `USB-порт недоступен после сброса. Подключись к нему заново; повторно прошивать автоматически не будем. ${String(e)}`;
        onLog("\n" + message + "\n");
        onEvent?.({ stage: "reconnect", message, warning: true });
      }
    } finally { ownsPort = false; }
  }
}

/** ROM identification only; no erase, flash writes or flasher stub upload. Resets the board. */
export async function detectMicrocontroller(onLog: (line: string) => void, onEvent?: EventSink): Promise<DetectedChip> {
  return withLoader(onLog, async (loader) => {
    onEvent?.({ stage: "rom", message: "Определение ROM; flash не меняется" });
    await loader.detectChip();
    const name = loader.chip.CHIP_NAME;
    const result = { name, board: boardFromChipName(name)?.id ?? null };
    onLog(`\nROM: ${name}\n`);
    try { await loader.after("hard_reset"); } catch { onLog("Сброс не подтверждён: нажми RST при необходимости.\n"); onEvent?.({ stage: "rom", message: "Сброс не подтверждён — нажми RST", warning: true }); }
    return result;
  }, onEvent);
}

export async function flashFirmware(
  image: Uint8Array,
  opts: {
    profile: BoardProfile;
    eraseAll: boolean;
    onDetected: (chip: DetectedChip) => void;
    onProgress: (p: FlashProgress) => void;
    onLog: (line: string) => void;
    onEvent?: EventSink;
  },
): Promise<string> {
  // Reject malformed / wrong-family image before opening ROM, and before any erase.
  opts.onEvent?.({ stage: "validate", message: `Проверка заголовка, ${image.length} bytes` });
  validateImage(image, opts.profile);
  return withLoader(opts.onLog, async (loader) => {
    opts.onProgress({ phase: "connecting", written: 0, total: image.length, message: "Определение и проверка чипа…" });
    opts.onEvent?.({ stage: "rom", message: "Соединение с ROM / инициализация RAM-stub" });
    // main() uploads a stub to RAM, not flash. writeFlash is called only after the match guard.
    await loader.main();
    const chip = loader.chip.CHIP_NAME;
    opts.onDetected({ name: chip, board: boardFromChipName(chip)?.id ?? null });
    opts.onEvent?.({ stage: "guard", message: `ROM: ${chip}; выбран ${opts.profile.label}` });
    assertChipMatches(chip, opts.profile);
    if (loader.secureDownloadMode) throw new Error("Secure Download Mode: прошивка из этого интерфейса запрещена.");
    if (opts.eraseAll) opts.onProgress({ phase: "erasing", written: 0, total: image.length, message: "Стирание и запись flash…" });
    opts.onEvent?.({ stage: "write", message: `Начало writeFlash; eraseAll=${opts.eraseAll}. Flash с этого момента мог измениться.` });
    await loader.writeFlash({
      fileArray: [{ data: image, address: opts.profile.flashOffset }],
      flashMode: "keep", flashFreq: "keep", flashSize: "keep", eraseAll: opts.eraseAll, compress: true,
      reportProgress: (_i, written, total) => opts.onProgress({ phase: "writing", written, total, message: "Запись прошивки…" }),
    });
    opts.onProgress({ phase: "done", written: image.length, total: image.length, message: "Запись завершена" });
    opts.onEvent?.({ stage: "reset", message: "writeFlash завершён; сброс платы. Загрузка MicroPython ещё не проверена." });
    try { await loader.after("hard_reset"); } catch { opts.onLog("Запись завершена, автоматический сброс не подтверждён. Нажми RST.\n"); opts.onEvent?.({ stage: "reset", message: "Автоматический сброс не подтверждён — нажми RST", warning: true }); }
    return chip;
  }, opts.onEvent);
}
