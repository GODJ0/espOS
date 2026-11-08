import { beforeEach, expect, mock, test } from "bun:test";
import { assertChipMatches, BOARDS, boardFromChipName, boardProfile, validateImage } from "../packages/web/src/shared/boards";

let actual = "ESP32-S3";
let writes: unknown[] = [];
let mainCalls = 0;
let romCalls = 0;
let isOpen = true;
let failReopen = false;
let failWrite = false;
let failRom = false;
let failConstructor = false;
let secure = false;
const serialMock = {
  port: { close: async () => { isOpen = false; } },
  releaseStreams: async () => undefined,
  reopen: async () => { if (failReopen) throw new Error("USB disconnected"); isOpen = true; },
  disconnect: async () => { isOpen = false; },
};
mock.module("../packages/web/src/web/lib/serial", () => ({ serial: serialMock }));
mock.module("../packages/web/src/web/lib/mpy", () => ({ mpy: { detach: () => undefined } }));
mock.module("esptool-js", () => ({
  Transport: class { async disconnect() { isOpen = false; } },
  ESPLoader: class {
    constructor() { if (failConstructor) throw new Error("Constructor failed"); }
    chip = { CHIP_NAME: actual };
    secureDownloadMode = secure;
    async main() { expect(isOpen).toBe(false); mainCalls++; isOpen = true; if (failRom) throw new Error("Failed to connect: timeout"); }
    async detectChip() { expect(isOpen).toBe(false); romCalls++; isOpen = true; if (failRom) throw new Error("Failed to connect: timeout"); }
    async after() { /* reset only */ }
    async writeFlash(options: unknown) { writes.push(options); if (failWrite) throw new Error("USB disconnected during write"); }
  },
}));
const { detectMicrocontroller, flashFirmware } = await import("../packages/web/src/web/lib/flash");
function image(id: number) {
  const b = new Uint8Array(64); b[0] = 0xe9; b[1] = 3; b[12] = id; b[13] = id >> 8; return b;
}
function options() {
  return { profile: boardProfile("esp32s3"), eraseAll: true, onDetected: () => undefined, onProgress: () => undefined, onLog: () => undefined };
}
beforeEach(() => { actual = "ESP32-S3"; writes = []; mainCalls = 0; romCalls = 0; isOpen = true; failReopen = false; failWrite = false; failRom = false; failConstructor = false; secure = false; });
test("all six header IDs and bootloader offsets", () => {
  for (const b of BOARDS) { validateImage(image(b.imageChipId), b); expect(boardFromChipName(b.label)?.id).toBe(b.id); }
  expect(boardProfile("esp32").flashOffset).toBe(4096);
  expect(boardProfile("esp32s2").flashOffset).toBe(4096);
  expect(boardProfile("esp32s3").flashOffset).toBe(0);
});
test("malformed and mismatched images are rejected", () => {
  expect(() => validateImage(new Uint8Array(3), boardProfile("esp32s3"))).toThrow();
  expect(() => validateImage(image(5), boardProfile("esp32s3"))).toThrow();
  expect(() => assertChipMatches("ESP32-C6", boardProfile("esp32s3"))).toThrow();
  expect(boardFromChipName("ESP8266")).toBeNull();
});
test("bad image fails before ROM and erase", async () => {
  await expect(flashFirmware(image(5), options())).rejects.toThrow();
  expect(mainCalls).toBe(0); expect(writes.length).toBe(0);
});
test("wrong connected chip never erases or writes", async () => {
  actual = "ESP32-C3";
  await expect(flashFirmware(image(9), options())).rejects.toThrow("Подключён ESP32-C3");
  expect(writes.length).toBe(0); expect(isOpen).toBe(true);
});
test("ROM auto-detection writes nothing and uploads no stub", async () => {
  actual = "ESP32-C6";
  expect(await detectMicrocontroller(() => undefined)).toEqual({ name: actual, board: "esp32c6" });
  expect(mainCalls).toBe(0); expect(romCalls).toBe(1); expect(writes.length).toBe(0);
});
test("matched chip writes at family-specific offset", async () => {
  actual = "ESP32-S2";
  await flashFirmware(image(2), { ...options(), profile: boardProfile("esp32s2") });
  const optionsWritten = writes[0] as { fileArray: { address: number }[] };
  expect(optionsWritten.fileArray[0]?.address).toBe(4096); expect(isOpen).toBe(true);
});
test("native USB disappearing after ROM is reported", async () => {
  failReopen = true;
  const logs: string[] = [];
  await detectMicrocontroller((s) => logs.push(s));
  expect(isOpen).toBe(false); expect(logs.join("")).toContain("Подключись");
});
test("write failure preserves stage evidence, cleanup and never retries", async () => {
  const { FlashJournal } = await import("../packages/web/src/web/lib/flash-diagnostics");
  const journal = new FlashJournal({ Target: "ESP32-S3" }); failWrite = true; failReopen = true;
  await expect(flashFirmware(image(9), { ...options(), onEvent: e => journal.event(e) })).rejects.toThrow("during write");
  expect(writes.length).toBe(1); expect(journal.flashMayHaveChanged).toBe(true); expect(journal.writeCompleted).toBe(false);
  expect(journal.lastOperationStage).toBe("write"); expect(isOpen).toBe(false);
  failWrite = false; failReopen = false; isOpen = true;
  await detectMicrocontroller(() => undefined); expect(writes.length).toBe(1);
});
test("ROM timeout cannot change flash", async () => {
  failRom = true;
  await expect(flashFirmware(image(9), options())).rejects.toThrow("timeout");
  expect(writes.length).toBe(0); expect(isOpen).toBe(true);
});
test("secure mode blocked before write", async () => {
  secure = true;
  await expect(flashFirmware(image(9), options())).rejects.toThrow("Secure Download Mode"); expect(writes.length).toBe(0);
});
test("constructor failure releases ownership for next probe", async () => {
  failConstructor = true;
  await expect(detectMicrocontroller(() => undefined)).rejects.toThrow("Constructor failed");
  failConstructor = false;
  await detectMicrocontroller(() => undefined); expect(romCalls).toBe(1);
});
