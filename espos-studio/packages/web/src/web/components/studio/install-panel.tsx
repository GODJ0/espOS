import { useState } from "react";
import { Check, Download, PackageOpen, RotateCcw } from "lucide-react";
import { useDevice } from "../device-context";
import { mpy } from "../../lib/mpy";
import { ESPOS_VERSION, esposFiles, esposFileList } from "../../lib/espos-files";
import { ActionButton, NeedsDevice, Notice, Panel, ProgressBar, errorText } from "./primitives";
import { cn } from "../../lib/utils";
import { WiringDiagram } from "./wiring-diagram";

type FileState = "pending" | "writing" | "done" | "error";

const PIN_ROWS = [
  ["SCLK", "12", "общий с touch"],
  ["MOSI", "11", "общий с touch"],
  ["MISO", "13", "общий с touch"],
  ["TFT CS", "10", ""],
  ["TFT DC", "9", ""],
  ["TFT RST", "14", ""],
  ["BL_EN *", "8", "только логический вход"],
  ["T_CS", "15", "XPT2046"],
  ["T_IRQ", "16", "XPT2046"],
];

export function InstallPanel() {
  const device = useDevice();
  const [states, setStates] = useState<Record<string, FileState>>({});
  const [current, setCurrent] = useState<{ path: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [installing, setInstalling] = useState(false);

  const totalBytes = esposFileList.reduce((n, p) => n + esposFiles[p]!.length, 0);
  const doneCount = Object.values(states).filter((s) => s === "done").length;

  async function install() {
    if (device.chip && device.chip.board !== "esp32s3") {
      setError("Пакет espOS настроен для S3 DevKitC. Перенос на этот чип пока не реализован.");
      return;
    }
    setError(null);
    setDone(false);
    setInstalling(true);
    device.setBusy(true);
    setStates(Object.fromEntries(esposFileList.map((p) => [p, "pending" as FileState])));
    try {
      // Drop compiled leftovers / stale package markers is not needed for .py; just write.
      for (const path of esposFileList) {
        setStates((s) => ({ ...s, [path]: "writing" }));
        setCurrent({ path, pct: 0 });
        try {
          await mpy.writeFile(path, esposFiles[path]!, (d, t) => setCurrent({ path, pct: t ? (d / t) * 100 : 100 }));
        } catch (e) {
          setStates((s) => ({ ...s, [path]: "error" }));
          throw e;
        }
        setStates((s) => ({ ...s, [path]: "done" }));
      }
      // apps/ must be an importable package on MicroPython for `apps.<name>.app`
      await mpy.exec("open('/apps/__init__.py','a').close()");
      await mpy.exec("import os\nfor _d in os.listdir('/apps'):\n    try:\n        os.stat('/apps/'+_d+'/app.py')\n        open('/apps/'+_d+'/__init__.py','a').close()\n    except OSError:\n        pass");
      setDone(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setCurrent(null);
      setInstalling(false);
      device.setBusy(false);
    }
  }

  async function reboot() {
    try {
      await mpy.softReset();
    } catch (e) {
      setError(errorText(e));
    }
  }

  function downloadBundle() {
    const lines = esposFileList.map((p) => `# ===== ${p} =====\n${esposFiles[p]}`).join("\n\n");
    const blob = new Blob([lines], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `espos-${ESPOS_VERSION}-sources.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[1.2fr_1fr]">
      <Panel
        kicker="03"
        title={`espOS ${ESPOS_VERSION}`}
        actions={
          <ActionButton icon={<Download className="size-3.5" />} onClick={downloadBundle}>
            Исходники
          </ActionButton>
        }
      >
        {device.status !== "connected" ? (
          <NeedsDevice />
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-4 p-4">
            <p className="text-sm text-muted-foreground">
              Копирует {esposFileList.length} файлов ({(totalBytes / 1024).toFixed(1)} KB) на файловую систему устройства через raw REPL —
              тот же протокол, что у <code className="font-mono text-foreground">mpremote</code>. Существующие файлы с теми же путями будут перезаписаны.
            </p>

            <Notice tone="warning">Установка espOS — только профиль S3 DevKitC. Поддержка других чипов во Flasher не переносит GPIO и драйверы. Если ROM ещё не проверен, сначала проверь семейство во вкладке «Прошивка».</Notice>
            <div className="flex flex-wrap items-center gap-2">
              <ActionButton
                tone="primary"
                loading={installing}
                disabled={(device.busy && !installing) || (!!device.chip && device.chip.board !== "esp32s3")}
                icon={<PackageOpen className="size-3.5" />}
                onClick={install}
              >
                Установить espOS
              </ActionButton>
              <ActionButton icon={<RotateCcw className="size-3.5" />} disabled={installing} onClick={reboot}>
                Soft reset
              </ActionButton>
              {(installing || done) && (
                <span className="font-mono text-xs text-muted-foreground">
                  {doneCount}/{esposFileList.length}
                </span>
              )}
            </div>

            {installing && <ProgressBar value={(doneCount / esposFileList.length) * 100} />}
            {done && <Notice tone="success">espOS установлен. Нажми «Soft reset» — на дисплее появится лаунчер.</Notice>}
            {error && <Notice tone="error">{error}</Notice>}

            <div className="min-h-0 flex-1 overflow-auto border border-border">
              {esposFileList.map((p) => {
                const st = states[p];
                return (
                  <div
                    key={p}
                    className={cn(
                      "flex items-center justify-between gap-3 border-b border-border/60 px-3 py-1.5 font-mono text-xs last:border-0",
                      st === "writing" && "bg-primary/5 text-primary",
                      st === "error" && "text-destructive",
                    )}
                  >
                    <span className="truncate">{p}</span>
                    <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                      {st === "writing" && current?.path === p && <span className="text-primary">{current.pct.toFixed(0)}%</span>}
                      {st === "done" && <Check className="size-3.5 text-success" />}
                      {(esposFiles[p]!.length / 1024).toFixed(1)}K
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Panel>

      <Panel kicker="HW" title="Распиновка по умолчанию">
        <div className="h-full overflow-y-auto flex flex-col gap-4 p-4">
          <p className="text-xs text-muted-foreground">
            ESP32-S3 DevKitC + 2.8" ILI9341 240×320 + XPT2046. Если подключено иначе — поменяй пины в{" "}
            <code className="font-mono text-foreground">/config.py</code> во вкладке «Редактор».
          </p>
          <WiringDiagram />
          <table className="w-full font-mono text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1.5 font-normal">сигнал</th>
                <th className="py-1.5 font-normal">GPIO</th>
                <th className="py-1.5 font-normal">примечание</th>
              </tr>
            </thead>
            <tbody>
              {PIN_ROWS.map(([sig, gpio, note]) => (
                <tr key={sig} className="border-b border-border/50">
                  <td className="py-1.5">{sig}</td>
                  <td className="py-1.5 text-primary">{gpio}</td>
                  <td className="py-1.5 text-muted-foreground">{note}</td>
                </tr>
              ))}
              <tr className="border-b border-border/50">
                <td className="py-1.5">VCC / GND</td>
                <td className="py-1.5 text-primary">по паспорту / GND</td>
                <td className="py-1.5 text-muted-foreground">питание</td>
              </tr>
            </tbody>
          </table>
          <Notice tone="warning">
            Не используй GPIO 19/20 — это нативный USB (D−/D+), через него идёт связь со Studio. GPIO 26–32 обычно заняты под память; при octal-памяти могут быть заняты и GPIO 33–37. Не подключай силовую подсветку к GPIO 8: нужен логический BL_EN либо внешний драйвер. VCC модуля сверяй с паспортом.
          </Notice>
        </div>
      </Panel>
    </div>
  );
}
