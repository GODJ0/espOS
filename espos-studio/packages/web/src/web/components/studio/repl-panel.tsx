import { useEffect, useRef, useState } from "react";
import { CornerDownLeft, Eraser, Octagon, RotateCcw } from "lucide-react";
import { useDevice } from "../device-context";
import { serial } from "../../lib/serial";
import { mpy } from "../../lib/mpy";
import { ActionButton, NeedsDevice, Panel, errorText } from "./primitives";

/** Strip ANSI escape sequences and raw-REPL control bytes for display. */
function clean(s: string) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

export function ReplPanel() {
  const device = useDevice();
  const [line, setLine] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  const [err, setErr] = useState<string | null>(null);
  const out = useRef<HTMLPreElement>(null);
  const connected = device.status === "connected";

  useEffect(() => {
    const el = out.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [device.log]);

  async function send(text: string) {
    setErr(null);
    try {
      // leave raw mode if a Studio operation left us there
      await mpy.exitRaw();
      await serial.write(text);
    } catch (e) {
      setErr(errorText(e));
    }
  }

  async function submit() {
    const cmd = line;
    setLine("");
    if (cmd.trim()) setHistory((h) => [cmd, ...h].slice(0, 100));
    setHIdx(-1);
    await send(cmd + "\r");
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") void submit();
    else if (e.key === "ArrowUp") {
      e.preventDefault();
      const i = Math.min(hIdx + 1, history.length - 1);
      if (i >= 0) {
        setHIdx(i);
        setLine(history[i]!);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const i = hIdx - 1;
      setHIdx(i);
      setLine(i >= 0 ? history[i]! : "");
    } else if (e.ctrlKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      void send("\x03");
    } else if (e.ctrlKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      void send("\x04");
    }
  }

  return (
    <Panel
      kicker="TTY"
      title="REPL"
      className="h-full"
      actions={
        connected && (
          <>
            <ActionButton icon={<Octagon className="size-3.5" />} onClick={() => send("\x03")} title="Ctrl-C — прервать (остановить лаунчер)">
              Ctrl-C
            </ActionButton>
            <ActionButton icon={<RotateCcw className="size-3.5" />} onClick={() => send("\x04")} title="Ctrl-D — soft reset">
              Ctrl-D
            </ActionButton>
            <ActionButton icon={<Eraser className="size-3.5" />} onClick={device.clearLog}>
              Очистить
            </ActionButton>
          </>
        )
      }
    >
      {!connected ? (
        <NeedsDevice />
      ) : (
        <div className="flex h-full min-h-0 flex-col bg-background">
          <pre ref={out} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-[12px] leading-5 text-foreground/90">
            {clean(device.log) || <span className="text-muted-foreground">Ожидание вывода… Нажми Ctrl-C, чтобы остановить лаунчер и получить {">>>"}</span>}
          </pre>
          {err && <div className="border-t border-destructive/40 px-4 py-1.5 font-mono text-xs text-destructive">{err}</div>}
          <div className="flex items-center gap-2 border-t border-border px-4 py-2">
            <span className="font-mono text-xs text-primary">{">>>"}</span>
            <input
              value={line}
              onChange={(e) => setLine(e.target.value)}
              onKeyDown={onKey}
              disabled={device.busy}
              aria-label="Команда REPL"
              spellCheck={false}
              placeholder={device.busy ? "устройство занято…" : "print('hi')"}
              className="h-8 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground/50"
            />
            <button onClick={submit} className="grid size-7 place-items-center border border-border text-muted-foreground hover:border-primary hover:text-primary">
              <CornerDownLeft className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}
