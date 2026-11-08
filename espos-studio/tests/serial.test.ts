import { expect, test } from "bun:test";
import { SerialManager } from "../packages/web/src/web/lib/serial";

test("USB unplug clears status immediately; reopen cannot silently succeed", async () => {
  let handler: ((e: { target: unknown }) => void) | undefined;
  const port = {
    readable: null as ReadableStream<Uint8Array> | null, writable: null as WritableStream<Uint8Array> | null,
    async open() { this.readable = new ReadableStream(); this.writable = new WritableStream(); },
    async close() {},
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { serial: { requestPort: async () => port, addEventListener: (_: string, cb: typeof handler) => { handler = cb; } } } });
  const manager = new SerialManager(); const statuses: string[] = []; manager.onStatus(s => statuses.push(s));
  await manager.connect(); expect(manager.status).toBe("connected");
  handler?.({ target: {} }); expect(manager.status).toBe("connected");
  handler?.({ target: port }); expect(manager.status).toBe("disconnected");
  await expect(manager.reopen()).rejects.toThrow("отключён");expect(statuses).toEqual(["connected", "disconnected"]);
});
test("stream failure clears stale connected state", async () => {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const port = { readable: null as ReadableStream<Uint8Array> | null, writable: null as WritableStream<Uint8Array> | null,
    async open() { this.readable = new ReadableStream({ start(c) { controller = c; } });this.writable = new WritableStream(); }, async close() {} };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { serial: { requestPort: async () => port } } });
  const manager = new SerialManager();await manager.connect();
  const disconnected = new Promise<void>(resolve => manager.onStatus(s => { if(s === "disconnected") resolve(); }));
  controller!.error(new Error("USB gone"));await disconnected;expect(manager.port).toBeNull();
});
test("cancelled picker frees connection lock for later request", async () => {
  let fail = true;
  const port = { async open() {}, async close() {} };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { serial: { requestPort: async () => { if (fail) throw new Error("No port selected"); return port; } } } });
  const manager = new SerialManager();await expect(manager.connect()).rejects.toThrow("No port");
  fail = false;await manager.connect();expect(manager.status).toBe("connected");await manager.disconnect();
});