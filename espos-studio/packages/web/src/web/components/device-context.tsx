import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isWebSerialSupported, serial, type SerialStatus } from "../lib/serial";
import { mpy } from "../lib/mpy";
import type { DetectedChip } from "../lib/flash";

export interface DeviceInfo {
  platform: string;
  version: string;
  freqMhz: number;
  freeMem: number;
  fsFreeKb: number;
}

interface DeviceContextValue {
  status: SerialStatus;
  supported: boolean;
  busy: boolean;
  setBusy: (b: boolean) => void;
  info: DeviceInfo | null;
  clearInfo: () => void;
  chip: DetectedChip | null;
  setChip: (c: DetectedChip | null) => void;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshInfo: () => Promise<void>;
  /** Raw serial log, as text, shared by the REPL panel and the flasher. */
  log: string;
  appendLog: (s: string) => void;
  clearLog: () => void;
}

const DeviceContext = createContext<DeviceContextValue | null>(null);

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SerialStatus>(() => (isWebSerialSupported() ? "disconnected" : "unsupported"));
  const [chip, setChip] = useState<DetectedChip | null>(null);
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const logBuffer = useRef("");

  useEffect(() => serial.onStatus((s) => {
    setStatus(s);
    if (s !== "connected") { setChip(null); setInfo(null); }
  }), []);

  useEffect(() => {
    const off = serial.onData((chunk) => {
      logBuffer.current += new TextDecoder().decode(chunk);
      if (logBuffer.current.length > 120_000) logBuffer.current = logBuffer.current.slice(-80_000);
      setLog(logBuffer.current);
    });
    return off;
  }, []);

  const appendLog = useCallback((s: string) => {
    logBuffer.current += s;
    setLog(logBuffer.current);
  }, []);

  const clearLog = useCallback(() => {
    logBuffer.current = "";
    setLog("");
  }, []);

  const clearInfo = useCallback(() => { setInfo(null); setError(null); }, []);

  const refreshInfo = useCallback(async () => {
    setBusy(true);
    try {
      const i = await mpy.deviceInfo();
      setInfo(i);
      setError(null);
    } catch (e) {
      setInfo(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await serial.connect(115200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }, []);

  const disconnect = useCallback(async () => {
    mpy.detach();
    await serial.disconnect();
    setInfo(null);
    setChip(null);
  }, []);

  const value = useMemo(
    () => ({
      status,
      supported: isWebSerialSupported(),
      busy,
      setBusy,
      info,
      clearInfo,
      chip,
      setChip,
      error,
      connect,
      disconnect,
      refreshInfo,
      log,
      appendLog,
      clearLog,
    }),
    [status, busy, info, clearInfo, chip, error, connect, disconnect, refreshInfo, log, appendLog, clearLog],
  );

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice(): DeviceContextValue {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error("useDevice must be used inside <DeviceProvider>");
  return ctx;
}
