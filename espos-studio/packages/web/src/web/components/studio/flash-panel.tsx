import { useRef, useState } from "react";
import { Cpu, Upload, Zap } from "lucide-react";
import { useFirmwareBuilds } from "../../queries/firmware";
import { useDevice } from "../device-context";
import { detectMicrocontroller, fetchFirmware, flashFirmware, type FlashProgress } from "../../lib/flash";
import { ActionButton, NeedsDevice, Notice, Panel, ProgressBar, errorText } from "./primitives";
import { cn } from "../../lib/utils";
import { serial } from "../../lib/serial";
import { BOARDS, boardProfile, formatOffset, type BoardId } from "../../../shared/boards";
import { FlashJournal, type FlashEvent, type FlashStage } from "../../lib/flash-diagnostics";
import { FlashRecovery } from "./flash-recovery";

function formatDate(d: string) {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

export function FlashPanel() {
  const device = useDevice();
  const [choice, setChoice] = useState<BoardId | "auto">("esp32s3");
  const board = choice === "auto" ? device.chip?.board ?? "esp32s3" : choice;
  const profile = boardProfile(board);
  const autoPending = choice === "auto" && !device.chip?.board;
  const builds = useFirmwareBuilds(board);
  const [detecting, setDetecting] = useState(false);
  const [localConfirmed, setLocalConfirmed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [eraseAll, setEraseAll] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<FlashProgress | null>(null);
  const [download, setDownload] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const journal = useRef<FlashJournal | null>(null);
  const [stage, setStage] = useState<FlashStage>("idle");
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const operationLock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const activeUrl = builds.data?.some((b) => b.url === selected) ? selected : builds.data?.[0]?.url ?? null;
  const working = progress !== null && progress.phase !== "done";
  const sourceLabel = localFile ? localFile.name : (builds.data?.find((b) => b.url === activeUrl)?.filename ?? "—");

  function beginSession(operation: string) {
    let usb = "not connected";
    try { const i = serial.port?.getInfo(); if (i) usb = `VID=${i.usbVendorId?.toString(16) ?? "unknown"} PID=${i.usbProductId?.toString(16) ?? "unknown"}`; } catch { usb = "unavailable"; }
    journal.current = new FlashJournal({ Operation: operation, Target: profile.label, Detected: device.chip?.name ?? "not probed", Offset: formatOffset(profile.flashOffset), Image: sourceLabel, EraseAll: String(eraseAll), Baud: "115200", USB: usb, Browser: navigator.userAgent, SecureContext: String(window.isSecureContext) });
    setLog(""); setStage("idle"); setRecoveryError(null);
  }
  function appendLog(s: string) { journal.current?.append(s); setLog(v => (v + s).slice(-16000)); }
  function event(e: FlashEvent) {
    journal.current?.event(e);
    if (e.stage !== "reconnect") setStage(e.stage);
    if (e.warning) setRecoveryError(e.message);
    setLog(v => (v + `[${e.stage}] ${e.message}\n`).slice(-16000));
  }
  function fail(e: unknown) {
    const message = errorText(e); setError(message); setRecoveryError(message);
    journal.current?.append(`ERROR: ${message}`);
  }
  async function reconnect() {
    if (device.busy || operationLock.current) return;
    operationLock.current = true; device.setBusy(true); setConfirming(false); setRecoveryError(null);
    if (!journal.current) beginSession("manual reconnect");
    appendLog("\nРучной выбор USB-порта; без ROM / flash команд.\n");
    try { await device.disconnect(); await device.connect(); }
    catch (e) { fail(e); }
    finally { device.setBusy(false); operationLock.current = false; }
  }

  function changeChoice(value: BoardId | "auto") {
    setChoice(value); setSelected(null); setLocalFile(null); setLocalConfirmed(false);
    setConfirming(false); setProgress(null); setError(null);
  }

  async function detect() {
    if (device.busy || operationLock.current) return;
    operationLock.current = true;
    beginSession("ROM probe");
    setConfirming(false); setProgress(null); setError(null); setLog("");
    device.clearInfo();
    setDetecting(true); device.setBusy(true);
    try {
      const chip = await detectMicrocontroller(appendLog, event);
      if (journal.current) journal.current.metadata.Detected = chip.name;
      if (serial.status === "connected") device.setChip(chip);
      else throw new Error(`Определён ${chip.name}, но USB-порт переподключился. Подключись заново и повтори определение либо выбери семейство вручную.`);
      if (!chip.board) throw new Error(`Определён ${chip.name}: для него пока нет профиля MicroPython в этом Web Flasher.`);
      changeChoice("auto");
    } catch (e) { fail(e); }
    finally { setDetecting(false); device.setBusy(false); operationLock.current = false; }
  }

  const mismatch = device.chip !== null && device.chip.board !== board;
  const blocked = device.busy || autoPending || mismatch || (!localFile && (!activeUrl || builds.isLoading || builds.isError)) || (!!localFile && !localConfirmed);

  function downloadLog() {
    if (!journal.current) beginSession("diagnostic snapshot");
    const a = document.createElement("a");
    const url = URL.createObjectURL(new Blob([journal.current!.export() + `\nCurrent connection: ${serial.status}\nConnection error: ${device.error ?? "none"}\n`], { type: "text/plain" }));
    a.href = url; a.download = "espos-flasher-log.txt"; a.click(); URL.revokeObjectURL(url);
  }

  async function run() {
    if (blocked || operationLock.current || serial.status !== "connected") return;
    operationLock.current = true;
    beginSession("flash");
    setConfirming(false);
    setError(null);
    setLog("");
    device.clearInfo();
    device.setBusy(true);
    try {
      let image: Uint8Array;
      event({ stage: "download", message: localFile ? "Чтение локального образа" : "Скачивание официального образа" });
      if (localFile) {
        image = new Uint8Array(await localFile.arrayBuffer());
      } else {
        if (!activeUrl) throw new Error("Выбери сборку прошивки");
        setDownload(0);
        image = await fetchFirmware(activeUrl, (l, t) => setDownload(t ? (l / t) * 100 : 0));
        setDownload(100);
      }
      await flashFirmware(image, {
        profile,
        eraseAll,
        onDetected: (chip) => { device.setChip(chip); if (journal.current) journal.current.metadata.Detected = chip.name; },
        onProgress: setProgress,
        onLog: appendLog,
        onEvent: event,
      });
    } catch (e) {
      fail(e);
      setProgress(null);
    } finally {
      device.setBusy(false);
      setDownload(null);
      operationLock.current = false;
    }
  }

  const pct = progress && progress.total ? (progress.written / progress.total) * 100 : 0;

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[1.1fr_1fr]">
      <Panel kicker="01" title="Прошивка MicroPython">
        <div className="h-full overflow-y-auto flex flex-col gap-4 p-4">
          <p className="text-sm text-muted-foreground">
            Выбери семейство вручную или определи его через ROM-загрузчик. Адрес записи зависит от семейства.
            Это расширение Web Flasher, а не готовый перенос espOS на другие платы.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-44 flex-1 flex-col gap-1.5 text-xs text-muted-foreground">
              Микроконтроллер
              <select aria-label="Микроконтроллер" value={choice} disabled={device.busy} onChange={(e) => changeChoice(e.target.value as BoardId | "auto")}
                className="h-9 border border-border bg-background px-2 font-mono text-sm text-foreground outline-none focus:border-primary">
                <option value="auto">Авто (ROM)</option>
                {BOARDS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            </label>
            <ActionButton loading={detecting} disabled={device.status !== "connected" || device.busy} onClick={detect} icon={<Cpu className="size-3.5" />}>Определить чип</ActionButton>
          </div>
          <p className="text-xs text-muted-foreground">Определение перезапускает плату, но не стирает и не записывает flash. USB VID/PID не используется как идентификатор чипа.</p>
          {device.chip && <Notice tone="info">ROM: <b>{device.chip.name}</b>. Семейство определено; flash, PSRAM, кварц и модель платы автоматически не подбираются.</Notice>}
          {mismatch && <Notice tone="error">Выбран {profile.label}, подключён {device.chip?.name}. Прошивка заблокирована — выбери совпадающее семейство.</Notice>}
          {autoPending ? <Notice tone="info">Подключи плату и нажми «Определить чип», чтобы получить список сборок для неё.</Notice> : <>
          <Notice tone="info">{profile.note} Адрес: {formatOffset(profile.flashOffset)}.</Notice>
          <div className="border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="font-display text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Сборки {profile.firmwareBoard}</span>
              <span className="font-mono text-[10px] text-muted-foreground">micropython.org</span>
            </div>
            <div className="max-h-64 overflow-auto">
              {builds.isLoading && <div className="px-3 py-4 font-mono text-xs text-muted-foreground">загрузка списка…</div>}
              {builds.isError && (
                <div className="px-3 py-4 text-xs text-destructive">Не удалось получить список: {errorText(builds.error)}</div>
              )}
              {builds.data?.map((b, i) => {
                const active = !localFile && activeUrl === b.url;
                return (
                  <button
                    key={b.url}
                    disabled={device.busy}
                    onClick={() => {
                      setConfirming(false); setProgress(null);
                      setSelected(b.url);
                      setLocalFile(null);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 border-b border-border/60 px-3 py-2 text-left font-mono text-xs transition-colors last:border-0 hover:bg-secondary",
                      active && "bg-primary/10 text-primary",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className={cn("size-1.5", active ? "bg-primary" : "bg-border")} />
                      {b.version}
                      {i === 0 && <span className="border border-success/50 px-1 text-[9px] uppercase text-success">latest</span>}
                    </span>
                    <span className="text-muted-foreground">{formatDate(b.date)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          </>}
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              aria-label="Файл прошивки .bin"
              type="file"
              accept=".bin"
              className="hidden"
              onChange={(e) => { setLocalFile(e.target.files?.[0] ?? null); setLocalConfirmed(false); setConfirming(false); setProgress(null); }}
            />
            <ActionButton disabled={device.busy || autoPending} icon={<Upload className="size-3.5" />} onClick={() => fileInput.current?.click()}>
              Свой .bin
            </ActionButton>
            {localFile && (
              <span className="font-mono text-xs text-primary">
                {localFile.name} · {(localFile.size / 1024).toFixed(0)} KB
              </span>
            )}
          </div>

          {localFile && <label className="flex items-start gap-2 text-xs text-warning">
            <input aria-label="Подтверждение формата локального образа" type="checkbox" checked={localConfirmed} disabled={device.busy} onChange={(e) => setLocalConfirmed(e.target.checked)} />
            Это полный образ с загрузчиком для {profile.label}, предназначенный для {formatOffset(profile.flashOffset)}, а не app-only/app-bin .bin. Полные сборки с разметкой OTA допустимы. Заголовок проверяется, но содержимое разделов и подпись не проверяются.
          </label>}
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" aria-label="Стереть flash" checked={eraseAll} disabled={device.busy} onChange={(e) => { setEraseAll(e.target.checked); setConfirming(false); }} className="accent-[#22d3ee]" />
            Полностью стереть flash перед записью
            <span className="text-xs text-muted-foreground">(рекомендуется при первой установке)</span>
          </label>
        </div>
      </Panel>

      <Panel kicker="02" title="Запись">
        <div className="flex h-full min-h-0 flex-col overflow-y-auto">
        {device.status !== "connected" ? (
          <div className="flex flex-col gap-3 p-4"><NeedsDevice />{error && <Notice tone="error">{error}</Notice>}{log && <><pre className="max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap">{log}</pre><ActionButton onClick={downloadLog}>Скачать журнал</ActionButton></>}</div>
        ) : (
          <div className="flex flex-col gap-4 p-4">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-xs">
              <span className="text-muted-foreground">образ</span>
              <span className="truncate">{sourceLabel}</span>
              <span className="text-muted-foreground">адрес</span>
              <span>{formatOffset(profile.flashOffset)}</span>
              <span className="text-muted-foreground">стирание</span>
              <span className={eraseAll ? "text-warning" : ""}>{eraseAll ? "весь flash" : "нет"}</span>
            </div>

            <Notice tone="info">
              У S3 DevKitC обычно два USB-разъёма. Если есть USB–UART (CP210x/CH343), для прошивки надёжнее он: нативный <b>USB</b> при сбросе
              переподключается как другое устройство и браузер теряет порт. Если используешь нативный USB — зажми <b>BOOT</b>, нажми{" "}
              <b>RST</b>, отпусти <b>BOOT</b> и подключись к появившемуся порту заново.
            </Notice>

            {confirming ? (
              <div className="flex flex-col gap-2 border border-warning/60 bg-warning/5 p-3">
                <p className="text-xs text-warning">
                  {eraseAll ? "Весь flash, включая файлы на устройстве, будет стёрт." : "Прошивка будет перезаписана."} Продолжить?
                </p>
                <div className="flex gap-2">
                  <ActionButton disabled={blocked} tone="warning" icon={<Zap className="size-3.5" />} onClick={run}>
                    Да, прошить
                  </ActionButton>
                  <ActionButton onClick={() => setConfirming(false)}>Отмена</ActionButton>
                </div>
              </div>
            ) : (
              <ActionButton
                tone="primary"
                icon={<Cpu className="size-3.5" />}
                loading={working || download !== null}
                disabled={blocked}
                onClick={() => setConfirming(true)}
                className="self-start"
              >
                {eraseAll ? "Стереть и прошить" : "Прошить"}
              </ActionButton>
            )}

            {download !== null && (
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] text-muted-foreground">скачивание · {download.toFixed(0)}%</span>
                <ProgressBar value={download} />
              </div>
            )}

            {progress && (
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {progress.message} · {pct.toFixed(0)}%
                </span>
                <ProgressBar value={pct} tone={progress.phase === "done" ? "success" : "primary"} />
              </div>
            )}

            {progress?.phase === "done" && (
              <Notice tone="success">Запись завершена. Проверь загрузку MicroPython; если порт пропал — подключись заново. espOS пока использует только профиль S3 DevKitC.</Notice>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            {(log || error) && <ActionButton onClick={downloadLog}>Скачать журнал</ActionButton>}

            {log && (
              <pre className="max-h-48 overflow-auto border border-border bg-background p-2 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                {log}
              </pre>
            )}
          </div>
        )}
        <div className="p-4 pt-0"><FlashRecovery error={recoveryError ?? device.error} stage={stage} flashMayHaveChanged={journal.current?.flashMayHaveChanged ?? false} writeCompleted={journal.current?.writeCompleted ?? false} busy={device.busy} connected={device.status === "connected"} supported={device.supported} reconnect={reconnect} downloadLog={downloadLog} /></div>
        </div>
      </Panel>
    </div>
  );
}
