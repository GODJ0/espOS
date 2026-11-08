import { useState } from "react";
import { Link } from "wouter";
import { BookOpen, Cpu, FileCode2, FolderTree, PackageOpen, Plug, Unplug, TerminalSquare, Wifi } from "lucide-react";
import { useDevice } from "../components/device-context";
import { FlashPanel } from "../components/studio/flash-panel";
import { InstallPanel } from "../components/studio/install-panel";
import { FilesPanel } from "../components/studio/files-panel";
import { EditorPanel } from "../components/studio/editor-panel";
import { ReplPanel } from "../components/studio/repl-panel";
import { WifiPanel } from "../components/studio/wifi-panel";
import { BeginnerPanel } from "../components/studio/beginner-panel";
import { ActionButton, Notice } from "../components/studio/primitives";
import { ESPOS_VERSION } from "../lib/espos-files";
import { cn } from "../lib/utils";

type Tab = "flash" | "install" | "files" | "editor" | "repl" | "wifi";

const TABS: { id: Tab; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: "flash", label: "Прошивка", icon: <Cpu className="size-4" />, hint: "MicroPython" },
  { id: "install", label: "Установка", icon: <PackageOpen className="size-4" />, hint: "espOS" },
  { id: "files", label: "Файлы", icon: <FolderTree className="size-4" />, hint: "FS" },
  { id: "editor", label: "Редактор", icon: <FileCode2 className="size-4" />, hint: "apps" },
  { id: "repl", label: "REPL", icon: <TerminalSquare className="size-4" />, hint: "tty" },
  { id: "wifi", label: "Wi-Fi", icon: <Wifi className="size-4" />, hint: "LAN / Android" },
];

function StatusRail({ advanced }: { advanced: boolean }) {
  const d = useDevice();
  const connected = d.status === "connected";

  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-card/80 px-3 py-2 backdrop-blur sm:px-5">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-lg font-bold tracking-tight">
          esp<span className="text-primary">OS</span>
        </span>
        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Studio</span>
        <span className="font-mono text-[10px] text-muted-foreground">v{ESPOS_VERSION}</span>
      </div>

      <div className="hidden items-center gap-5 font-mono text-[11px] md:flex">
        <span className="flex items-center gap-2">
          <span className={cn("size-2", connected ? "live-dot bg-primary" : "bg-border")} />
          <span className={connected ? "text-primary" : "text-muted-foreground"}>
            {d.status === "unsupported" ? "WebSerial недоступен" : connected ? (d.busy ? "занято" : "подключено") : "нет устройства"}
          </span>
        </span>
        {d.info && (
          <>
            <span className="text-muted-foreground">
              chip <span className="text-foreground">{d.chip?.name ?? d.info.platform}</span>
            </span>
            <span className="text-muted-foreground">
              cpu <span className="text-foreground">{d.info.freqMhz} MHz</span>
            </span>
            <span className="text-muted-foreground">
              heap <span className="text-foreground">{(d.info.freeMem / 1024).toFixed(0)} KB</span>
            </span>
            <span className="text-muted-foreground">
              fs <span className="text-foreground">{d.info.fsFreeKb} KB</span>
            </span>
          </>
        )}
      </div>

      <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
        {connected && advanced && <ActionButton disabled={d.busy} onClick={d.refreshInfo} title="Прерывает приложение на плате, читает MicroPython REPL">Статус REPL</ActionButton>}
        {d.error && <span className="max-w-72 truncate font-mono text-[11px] text-destructive">{d.error}</span>}
        {connected ? (
          <ActionButton tone="danger" icon={<Unplug className="size-3.5" />} disabled={d.busy} onClick={d.disconnect}>
            Отключить
          </ActionButton>
        ) : (
          <ActionButton tone="primary" icon={<Plug className="size-3.5" />} disabled={!d.supported || d.busy} onClick={d.connect}>
            Подключить
          </ActionButton>
        )}
      </div>
    </header>
  );
}

function UnsupportedBanner() {
  return (
    <div className="mx-5 mt-4">
      <Notice tone="warning">
        Этот браузер не поддерживает WebSerial. Открой Studio в <b>Chrome</b>, <b>Edge</b> или <b>Opera</b> на ПК. Android/OTG требует отдельной проверки и реализации USB-транспорта; текущий MVP его не гарантирует.
        Без браузера:{" "}
        <code className="font-mono">esptool.py --chip esp32s3 write_flash -z 0 firmware.bin</code> и{" "}
        <code className="font-mono">mpremote cp -r lib apps :</code>
      </Notice>
    </div>
  );
}

export default function Index() {
  const device = useDevice();
  const [mode, setMode] = useState<"beginner" | "advanced" | null>(null);
  const [tab, setTab] = useState<Tab>("flash");
  const [openPath, setOpenPath] = useState<string | null>(null);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <StatusRail advanced={mode === "advanced"} />
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-5 py-2">
        <span className="text-xs text-muted-foreground">{mode === "beginner" ? "Простой старт · S3 без экрана" : mode === "advanced" ? "Расширенный режим · все инструменты" : "Выбери способ работы"}</span>
        {mode && <ActionButton disabled={device.busy} onClick={()=>setMode(null)}>Сменить режим</ActionButton>}
      </div>
      {mode === null && <main className="min-h-0 flex-1 overflow-auto p-5"><div className="mx-auto flex max-w-4xl flex-col gap-6 py-8 sm:py-14">
        <p className="font-mono text-xs text-primary">ТВОЯ ПЛАТА. ТВОЙ ТЕМП.</p>
        <h1 className="max-w-xl font-display text-3xl font-semibold sm:text-4xl">Первый запуск или полный контроль?</h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">Оба режима работают с той же платой. Можно начать с подсказок, а позже перейти к инструментам. Выбор режима ничего не записывает на устройство.</p>
        <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
          <section className="flex flex-col gap-4 border border-primary/40 bg-primary/5 p-6"><span className="font-mono text-xs text-primary">01 / ДЛЯ ПЕРВОГО РАЗА</span><h2 className="font-display text-xl">Простой старт</h2><p className="text-sm leading-relaxed">USB-установка по шагам для ESP32-S3 DevKitC. Без дисплея, без настройки пинов, с проверкой запуска и понятным восстановлением.</p><p className="text-xs text-muted-foreground">Адрес и скорость — автоматически. Тип памяти — только по проверенной маркировке. Стирание — с подтверждением.</p><ActionButton disabled={device.busy} tone="primary" className="h-auto min-h-9 self-start py-2" onClick={()=>setMode("beginner")}>Открыть простой старт</ActionButton></section>
          <section className="flex flex-col gap-4 border border-border bg-card p-6"><span className="font-mono text-xs text-muted-foreground">02 / ДЛЯ РАЗРАБОТКИ</span><h2 className="font-display text-xl">Расширенный режим</h2><p className="text-sm leading-relaxed">Прошивальщик шести семейств, установка espOS, файлы, редактор, REPL и Wi-Fi. Все существующие инструменты на месте.</p><p className="text-xs text-muted-foreground">Поддержка чипа в прошивальщике не означает перенос espOS: пакет пока только для S3.</p><ActionButton disabled={device.busy} className="mt-auto h-auto min-h-9 self-start py-2" onClick={()=>setMode("advanced")}>Открыть расширенный режим</ActionButton></section>
        </div><p className="text-xs text-muted-foreground">USB: Chrome/Edge на ПК, localhost или HTTPS. Реальные S3 и мобильные устройства ещё требуют проверки.</p>
      </div></main>}
      {mode === "beginner" && <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-5"><BeginnerPanel /></main>}
      {mode === "advanced" && !device.supported && tab !== "wifi" && <UnsupportedBanner />}
      {mode === "advanced" && <div className="flex min-h-0 flex-1">
        <nav className="flex w-16 shrink-0 flex-col border-r border-border bg-sidebar md:w-48">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              aria-label={t.label}
              title={t.label}
              onClick={() => setTab(t.id)}
              className={cn(
                "group relative flex items-center gap-3 border-b border-border/60 px-5 py-3.5 text-left transition-colors hover:bg-secondary",
                tab === t.id && "bg-secondary",
              )}
            >
              {tab === t.id && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
              <span className={cn("text-muted-foreground", tab === t.id && "text-primary")}>{t.icon}</span>
              <span className="hidden flex-1 md:block">
                <span className="block font-display text-[12px] font-semibold uppercase tracking-[0.12em]">{t.label}</span>
                <span className="block font-mono text-[10px] text-muted-foreground">
                  0{i + 1} · {t.hint}
                </span>
              </span>
            </button>
          ))}
          <Link to="/guide" className="mt-auto flex items-center gap-3 border-t border-border px-5 py-3.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-primary">
            <BookOpen className="size-4" />
            <span className="hidden font-display text-[12px] font-semibold uppercase tracking-[0.12em] md:block">Инструкция</span>
          </Link>
          <div className="hidden border-t border-border p-4 font-mono text-[10px] leading-relaxed text-muted-foreground md:block">
            USB-CDC · 115200
            <br />
            Wi-Fi · LAN / BLE — позже
          </div>
        </nav>
        <main className="min-h-0 flex-1 overflow-auto p-5">
          {tab === "flash" && <FlashPanel />}
          {tab === "install" && <InstallPanel />}
          {tab === "files" && (
            <FilesPanel
              onOpen={(p) => {
                setOpenPath(p);
                setTab("editor");
              }}
            />
          )}
          {tab === "editor" && <EditorPanel path={openPath} setPath={setOpenPath} />}
          {tab === "repl" && <ReplPanel />}
          {tab === "wifi" && <WifiPanel />}
        </main>
      </div>}
    </div>
  );
}
