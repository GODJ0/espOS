/**
 * Thin WebSerial layer shared by the REPL terminal, the MicroPython raw-REPL
 * client and esptool-js. One port, one owner at a time: the reader lock is
 * handed over explicitly so flashing and REPL work can't fight over the stream.
 */

export type SerialListener = (chunk: Uint8Array) => void;

export type SerialStatus = "unsupported" | "disconnected" | "connected";

export function isWebSerialSupported(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

export class SerialManager {
  port: SerialPort | null = null;
  baudRate = 115200;

  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private listeners = new Set<SerialListener>();
  private pumping = false;
  private statusListeners = new Set<(s: SerialStatus) => void>();
  private connecting = false;
  private watchingDisconnect = false;

  private watchDisconnect() {
    if (this.watchingDisconnect || !navigator.serial.addEventListener) return;
    this.watchingDisconnect = true;
    navigator.serial.addEventListener("disconnect", (event) => {
      if (event.target === this.port) void this.disconnect();
    });
  }

  get status(): SerialStatus {
    if (!isWebSerialSupported()) return "unsupported";
    return this.port ? "connected" : "disconnected";
  }

  onStatus(fn: (s: SerialStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  private emitStatus() {
    for (const fn of this.statusListeners) fn(this.status);
  }

  onData(fn: SerialListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Ask the user for a port and open it. Must be called from a user gesture. */
  async connect(baudRate = 115200): Promise<void> {
    if (!isWebSerialSupported()) throw new Error("WebSerial is not available in this browser");
    if (this.connecting) throw new Error("Выбор USB-порта уже выполняется.");
    if (this.port) return;
    this.connecting = true;
    this.watchDisconnect();
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate });
      this.port = port;
      this.baudRate = baudRate;
      try { await this.startPump(); } catch (e) { await this.disconnect(); throw e; }
      this.emitStatus();
    } finally { this.connecting = false; }
  }

  async disconnect(): Promise<void> {
    const port = this.port;
    this.port = null;
    this.emitStatus();
    await this.stopPump();
    try {
      await port?.close();
    } catch {
      /* already gone */
    }
  }

  /** Reopen the port at a different baud rate (used after flashing). */
  async reopen(baudRate = this.baudRate): Promise<void> {
    const port = this.port;
    if (!port) throw new Error("USB-порт отключён. Подключись заново.");
    await this.stopPump();
    try {
      await port.close();
    } catch {
      /* ignore */
    }
    await port.open({ baudRate });
    if (this.port !== port) {
      try { await port.close(); } catch { /* detached */ }
      throw new Error("USB-порт отключён во время переподключения.");
    }
    this.baudRate = baudRate;
    await this.startPump();
    this.emitStatus();
  }

  /**
   * Release our reader/writer so another consumer (esptool-js Transport) can
   * take the raw port. Call `startPump()` again afterwards.
   */
  async releaseStreams(): Promise<void> {
    await this.stopPump();
  }

  async startPump(): Promise<void> {
    if (!this.port || this.pumping) return;
    if (!this.port.readable || !this.port.writable) return;
    this.pumping = true;
    this.writer = this.port.writable.getWriter();
    this.reader = this.port.readable.getReader();
    void this.pump();
  }

  private async pump(): Promise<void> {
    const reader = this.reader;
    if (!reader) return;
    try {
      while (this.pumping) {
        const { value, done } = await reader.read();
        if (done) {
          if (this.pumping && this.reader === reader) void this.disconnect();
          break;
        }
        if (value && value.length) {
          for (const fn of this.listeners) fn(value);
        }
      }
    } catch {
      if (this.pumping && this.reader === reader) void this.disconnect();
    }
  }

  private async stopPump(): Promise<void> {
    this.pumping = false;
    try {
      await this.reader?.cancel();
    } catch {
      /* ignore */
    }
    try {
      this.reader?.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      this.writer?.releaseLock();
    } catch {
      /* ignore */
    }
    this.reader = null;
    this.writer = null;
  }

  async write(data: Uint8Array | string): Promise<void> {
    if (!this.writer) throw new Error("Device is not connected");
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    await this.writer.write(bytes);
  }

  async setSignals(signals: SerialOutputSignals): Promise<void> {
    await this.port?.setSignals(signals);
  }
}

export const serial = new SerialManager();
