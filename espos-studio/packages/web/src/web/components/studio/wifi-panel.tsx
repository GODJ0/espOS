import { useState } from "react";
import { Wifi } from "lucide-react";
import { useLanCommand, useLanConfig } from "../../queries/lan";
import { useDevice } from "../device-context";
import { mpy } from "../../lib/mpy";
import { ActionButton, Notice, Panel, errorText } from "./primitives";

interface Entry { name: string; path: string; directory: boolean; size: number }
export function WifiPanel() {
  const device = useDevice(); const config = useLanConfig(); const rpc = useLanCommand();
  const [token, setToken] = useState(""); const [ssid, setSsid] = useState(""); const [password, setPassword] = useState("");
  const [provisionConfirm, setProvisionConfirm] = useState(false); const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [paired, setPaired] = useState(false);
  const [revokeConfirm, setRevokeConfirm] = useState(false);
  const [directory, setDirectory] = useState("/apps"); const [entries, setEntries] = useState<Entry[]>([]);
  const [file, setFile] = useState<{path: string; revision: string} | null>(null); const [text, setText] = useState("");
  const [confirm, setConfirm] = useState<"write" | "reboot" | null>(null);
  const busy = provisioning || rpc.isPending || device.busy;
  const ready = !!config.data?.enabled && /^[a-f0-9]{64}$/.test(token) && !busy;
  const appReady = ready && paired;
  function clearEvidence() { setPaired(false);setStatus(null);setFile(null);setEntries([]);setText("");setConfirm(null);setDirectory("/apps");setNotice(null); }
  function newToken() { clearEvidence();const b = crypto.getRandomValues(new Uint8Array(32));setToken(Array.from(b,x => x.toString(16).padStart(2,"0")).join("")); }
  async function revoke() {
    if (!revokeConfirm || device.status !== "connected" || busy) return;
    setProvisioning(true);device.setBusy(true);clearEvidence();setError(null);
    try {
      await mpy.writeFile("/network_config.py", "# LAN access revoked. Re-provision over USB to enable.\nENABLED = False\n");
      setToken("");setPassword("");setRevokeConfirm(false);
      setNotice("LAN отключён в конфигурации, старый токен удалён из неё. Выполни Soft reset по USB для применения и проверь, что LAN недоступен. Это не гарантирует физическое стирание секрета из flash.");
    } catch { setError("Отзыв доступа не подтверждён. Останови плату по USB и проверь /network_config.py; не считай токен отозванным."); }
    finally { setProvisioning(false);device.setBusy(false); }
  }
  async function provision() {
    if (!provisionConfirm || device.status !== "connected" || busy || !/^[a-f0-9]{64}$/.test(token) || !ssid || !password) return;
    setProvisioning(true); device.setBusy(true);setError(null);setNotice(null);
    clearEvidence();
    try {
      const content = `# Device-only secrets. Never add to a source archive.\nENABLED = True\nWIFI_SSID = ${JSON.stringify(ssid)}\nWIFI_PASSWORD = ${JSON.stringify(password)}\nPAIRING_TOKEN = ${JSON.stringify(token)}\n`;
      await mpy.writeFile("/network_config.py", content);
      setPassword("");setProvisionConfirm(false);
      setNotice("Настройки записаны по USB. Сохрани токен вне чата, затем выполни Soft reset в USB-вкладке. IP появится в USB REPL. Требуется новая версия espOS с net_service.py.");
    } catch { setError("USB-настройка не подтверждена. Проверь соединение и наличие net_service.py. Секреты не выводятся в журнал; не запускай перезапуск до проверки файла по USB."); }
    finally { setProvisioning(false);device.setBusy(false); }
  }
  async function command(cmd: Parameters<typeof rpc.mutateAsync>[0]["command"]) {
    if (!ready || (cmd.op !== "status" && !paired)) return;
    setError(null);setNotice(null);setConfirm(null);
    try {
      const data = await rpc.mutateAsync({ token, command: cmd });
      if(cmd.op === "status") { if (data.protocol !== "espos-lan-v2") throw new Error("Несовместимый Wi-Fi протокол.");setPaired(true);setStatus(data);setNotice("Сопряжение проверено: challenge и ответ подписаны Wi-Fi v2. Это доказательство общего секрета, не постоянное соединение и не шифрование."); }
      if(cmd.op === "list") { setDirectory(String(data.path));setEntries(data.entries as Entry[]); }
      if(cmd.op === "read") { setFile({path:String(data.path),revision:String(data.revision)});setText(String(data.content)); }
      if(cmd.op === "write") { setFile({path:String(data.path),revision:String(data.revision)});setNotice("Файл обновлён. Код применится после перезапуска; общий пакет espOS не обновлялся."); }
      if(cmd.op === "reboot") { clearEvidence();setNotice("Плата приняла перезапуск. Дождись её подключения к Wi-Fi и проверь статус вручную."); }
    } catch(e) { clearEvidence();setError(errorText(e)); }
    finally { rpc.reset(); } // Never retain the pairing token in mutation-cache variables.
  }
  return <div className="grid min-h-full gap-4 lg:grid-cols-[1fr_1.2fr]">
    <Panel kicker="LAN" title="Wi-Fi · S3 / локальная сеть">
      <div className="flex flex-col gap-4 p-4">
        <Notice tone="warning">Первичная установка и ROM-восстановление — USB. Здесь только статус и существующие текстовые файлы /apps (до 16 KiB), без MicroPython OTA и полного Python REPL. BLE — следующий этап.</Notice>
        <p className="text-sm text-muted-foreground">ПК запускает локальный Studio и обращается к плате. Android/iPhone открывает этот же Studio по LAN-адресу ПК — WebSerial на телефоне не нужен. Публичный предпросмотр не подключается к твоей локальной плате.</p>
        {config.isLoading && <p className="font-mono text-xs">Проверка LAN bridge…</p>}
        {config.isError && <Notice tone="error">{errorText(config.error)}</Notice>}
        {config.data && <Notice tone={config.data.enabled ? "info" : "warning"}>{config.data.enabled ? `Bridge настроен для ${config.data.device}:8765. Доступность платы ещё не проверена.` : "LAN bridge выключен по умолчанию. Для настройки смотри инструкцию ниже."}</Notice>}
        <label className="flex flex-col gap-2 text-xs">Токен сопряжения (64 hex-символа)
          <input aria-label="Токен Wi-Fi" type="password" autoComplete="off" value={token} disabled={busy} onChange={e=>{setToken(e.target.value.trim().toLowerCase());clearEvidence();}} className="h-9 border border-border bg-background px-2 font-mono" />
        </label>
        <div className="flex flex-wrap gap-2"><ActionButton disabled={busy} onClick={newToken}>Создать токен</ActionButton><ActionButton disabled={!ready} onClick={()=>command({op:"status"})} icon={<Wifi className="size-3.5"/>}>Проверить сопряжение / статус</ActionButton><ActionButton disabled={busy} onClick={()=>{setToken("");setPassword("");clearEvidence();}}>Забыть сессию</ActionButton></div>
        <Notice tone={paired ? "info" : "warning"}>{paired ? "Общий секрет подтверждён подписанным ответом. Каждый следующий ответ проверяется отдельно." : "Сопряжение не проверено. Файлы и reboot заблокированы до подписанного статуса v2. Неподписанный v1 не поддерживается — обнови плату и Studio вместе по USB."}</Notice>
        <p className="text-xs text-muted-foreground">Токен не сохраняется в браузере. Для переноса на телефон можно скопировать его вручную из поля после создания. HTTP между телефоном и Studio передаёт сам токен без шифрования; между Studio и платой HMAC защищает целостность, но не скрывает файлы. Только доверенная изолированная сеть; предпочтителен HTTPS на локальном Studio. Без проброса портов и публичного доступа.</p>
        <details><summary className="cursor-pointer text-xs text-primary">Настройка платы через USB</summary><div className="mt-3 flex flex-col gap-3">
          <label className="text-xs">SSID<input aria-label="SSID Wi-Fi" value={ssid} disabled={busy} onChange={e=>setSsid(e.target.value)} className="mt-1 h-9 w-full border border-border bg-background px-2" /></label>
          <label className="text-xs">Пароль сети<input aria-label="Пароль Wi-Fi" type="password" autoComplete="off" value={password} disabled={busy} onChange={e=>setPassword(e.target.value)} className="mt-1 h-9 w-full border border-border bg-background px-2" /></label>
          <label className="flex gap-2 text-xs"><input aria-label="Подтверждение Wi-Fi настройки" type="checkbox" checked={provisionConfirm} disabled={busy} onChange={e=>setProvisionConfirm(e.target.checked)}/>Подтверждаю замену /network_config.py и включение LAN-сервиса на доверенной защищённой сети.</label>
          <ActionButton loading={provisioning} disabled={!provisionConfirm || device.status!=="connected" || busy || !ssid || !password || !/^[a-f0-9]{64}$/.test(token) || (!!device.chip && device.chip.board!=="esp32s3")} onClick={provision}>Записать Wi-Fi настройки по USB</ActionButton>
          <p className="text-xs text-muted-foreground">Сначала установи обновлённый espOS по USB. BOOT safe mode пропускает сетевой сервис; USB Ctrl-C остаётся способом остановить лаунчер. Настройки секретны и не входят в пакет обновления.</p>
          <p className="text-xs text-muted-foreground">Создание нового токена в поле не меняет плату. Для ротации запиши новый токен с SSID/паролем по USB и перезапусти; старые клиенты потеряют доступ. «Забыть сессию» не отзывает доступ.</p>
          <label className="flex gap-2 text-xs"><input aria-label="Подтверждение отзыва LAN" type="checkbox" checked={revokeConfirm} disabled={busy} onChange={e=>setRevokeConfirm(e.target.checked)}/>Подтверждаю удаление сетевых настроек и отключение LAN-доступа через USB.</label>
          <ActionButton disabled={!revokeConfirm || busy || device.status!=="connected"} onClick={revoke}>Отозвать LAN-доступ по USB</ActionButton>
        </div></details>
        <details><summary className="cursor-pointer text-xs text-primary">Настройка локального Studio / Android</summary><div className="mt-2 space-y-2 text-xs text-muted-foreground">
          <p>В корневом .env локального Studio включи следующие параметры, указав реальные IP:</p>
          <pre className="overflow-auto border border-border p-2">{`ESPOS_LAN_ENABLED=true\nESPOS_LAN_DEVICE_IP=192.168.1.80\nESPOS_LAN_ORIGINS=http://localhost:4200,http://192.168.1.10:4200`}</pre>
          <p>Перезапусти Studio. С телефона в той же сети открой http://IP_ПК:4200 и введи токен. Разреши 4200 в firewall только для доверенной LAN. Не переноси эти настройки на публичный VPS.</p>
        </div></details>
        {status && <pre className="max-h-56 overflow-auto border border-border p-2 font-mono text-xs">{JSON.stringify(status,null,2)}</pre>}
        {notice && <Notice tone="info">{notice}</Notice>}{error && <Notice tone="error">{error}</Notice>}
      </div>
    </Panel>
    <Panel kicker="APPS" title="Файлы приложений по Wi-Fi"><div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap gap-2"><ActionButton disabled={!appReady} onClick={()=>command({op:"list",path:directory})}>Обновить список</ActionButton><ActionButton disabled={!appReady || directory==="/apps"} onClick={()=>command({op:"list",path:directory.slice(0,directory.lastIndexOf("/"))})}>Вверх</ActionButton><span className="self-center font-mono text-xs">{directory}</span></div>
      <div className="max-h-56 overflow-auto border border-border">{entries.length===0 && <p className="p-3 text-xs text-muted-foreground">Нажми «Обновить список» после настройки bridge и токена.</p>}{entries.map(e=><button key={e.path} disabled={!appReady} onClick={()=>command({op:e.directory?"list":"read",path:e.path})} className="flex w-full justify-between gap-2 border-b border-border px-3 py-2 text-left font-mono text-xs hover:bg-secondary"><span>{e.directory?"[dir] ":""}{e.name}</span><span>{e.size} B</span></button>)}</div>
      {file && <><p className="break-all font-mono text-xs text-primary">{file.path}</p><textarea aria-label="Wi-Fi редактор файла" value={text} disabled={busy} onChange={e=>{setText(e.target.value);setConfirm(null);}} className="min-h-64 w-full border border-border bg-background p-3 font-mono text-xs" spellCheck={false}/><p className="font-mono text-xs text-muted-foreground">{new TextEncoder().encode(text).length} / 16384 bytes · защита revision от перезаписи чужих изменений</p><ActionButton disabled={!appReady || new TextEncoder().encode(text).length>16384} onClick={()=>setConfirm("write")}>Сохранить файл по Wi-Fi</ActionButton></>}
      <ActionButton disabled={!appReady} onClick={()=>setConfirm("reboot")}>Перезапустить плату по Wi-Fi</ActionButton>
      {confirm && <Notice tone="warning">{confirm==="write" ? `Перезаписать ${file?.path}? Обновление Python-кода даёт ему права на плате после запуска. Сохрани резервную копию; не запускай неизвестный код.` : "Перезапустить плату? Приложение остановится, Wi-Fi временно пропадёт."}<div className="mt-2 flex gap-2"><ActionButton disabled={!appReady} onClick={()=>{if(confirm==="write" && file) void command({op:"write",path:file.path,revision:file.revision,content:text,confirm:true});else void command({op:"reboot",confirm:true});}}>Подтвердить действие</ActionButton><ActionButton disabled={busy} onClick={()=>setConfirm(null)}>Отмена</ActionButton></div></Notice>}
      {rpc.isPending && <p className="font-mono text-xs text-primary">Подписанный Wi-Fi запрос…</p>}
      <Notice tone="info">Обновляются только существующие файлы приложений. /config.py, /network_config.py, /boot.py, /main.py и /lib закрыты для Wi-Fi. Установка пакета и восстановление остаются по USB. Файлы применяются после явного перезапуска.</Notice>
    </div></Panel>
  </div>;
}