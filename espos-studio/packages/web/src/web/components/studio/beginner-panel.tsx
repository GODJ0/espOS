import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useDevice } from "../device-context";
import { ActionButton, Notice, Panel, ProgressBar, errorText } from "./primitives";
import { detectMicrocontroller, fetchFirmware, flashFirmware } from "../../lib/flash";
import { beginnerBuild, installBeginner, verifyBeginnerBoot, type MemoryChoice } from "../../lib/beginner";
import { useFirmwareBuilds } from "../../queries/firmware";
import { boardProfile } from "../../../shared/boards";
import { serial } from "../../lib/serial";
import { mpy } from "../../lib/mpy";
import { FlashJournal, type FlashEvent } from "../../lib/flash-diagnostics";
import { FlashRecovery } from "./flash-recovery";
import { cn } from "../../lib/utils";

const STEPS = ["Подготовка", "Проверка платы", "MicroPython", "Установка espOS", "Первый запуск", "Готово"];
export function BeginnerPanel() {
  const device = useDevice();
  const builds = useFirmwareBuilds("esp32s3");
  const [step,setStep] = useState(0);
  const [prepared,setPrepared] = useState(false);
  const [memory,setMemory] = useState<MemoryChoice>("unknown");
  const [erase,setErase] = useState(false);
  const [overwrite,setOverwrite] = useState(false);
  const [copied,setCopied] = useState(false);
  const [verified,setVerified] = useState(false);
  const [boot,setBoot] = useState(false);
  const [notice,setNotice] = useState<string | null>(null);
  const [error,setError] = useState<string | null>(null);
  const [task,setTask] = useState("");
  const [pct,setPct] = useState(0);
  const [,redraw] = useState(0);
  const journal = useRef(new FlashJournal({Operation:"Simple start",Target:"ESP32-S3",Offset:"0x0",Baud:"115200"}));
  const lock = useRef(false);
  const build = beginnerBuild(builds.data ?? [],memory);
  const connected = device.status === "connected";
  const s3 = connected && device.chip?.board === "esp32s3";
  const busy = device.busy || !!task;
  useEffect(() => serial.onStatus(status => {
    if (status !== "connected") { setVerified(false);setCopied(false);setBoot(false);setErase(false);setOverwrite(false); }
  }),[]);
  function event(e: FlashEvent) { journal.current.event(e);redraw(n=>n+1); }
  function log(line: string) { journal.current.append(line); }
  async function run(label:string,fn:()=>Promise<void>) {
    if (lock.current || device.busy) return;
    lock.current=true; device.setBusy(true);setTask(label);setError(null);setNotice(null);setPct(0);
    journal.current.append(label);
    try { await fn(); }
    catch(e) { setBoot(false);const message=errorText(e);setError(message);journal.current.append(`ERROR: ${message}`); }
    finally { lock.current=false;device.setBusy(false);setTask("");redraw(n=>n+1); }
  }
  async function probe() {
    if (!prepared || !connected) return;
    await run("Определяем чип без записи…",async()=>{
      setVerified(false);setBoot(false);device.clearInfo();device.setChip(null);
      const chip=await detectMicrocontroller(log,event);
      if(serial.status!=="connected") throw new Error(`ROM определён: ${chip.name}, но USB исчез. Выбери порт заново и повтори проверку.`);
      device.setChip(chip);
      if(chip.board!=="esp32s3") throw new Error(`Подключён ${chip.name}, выбран ESP32-S3. Запись запрещена: espOS пока не перенесён на эту плату.`);
      setNotice("Чип ESP32-S3 подтверждён. Модель DevKitC и вариант памяти определяем по маркировке, не по USB-порту.");
      setStep(2);
    });
  }
  async function checkMicroPython() {
    if(!s3 || !prepared) return;
    await run("Проверяем ответ MicroPython…",async()=>{
      setVerified(false);setBoot(false);
      const info=await mpy.deviceInfo();
      if(info.platform!=="esp32" || !/MicroPython/.test(info.version)) throw new Error("Совместимый MicroPython не подтверждён.");
      if(serial.status!=="connected") throw new Error("USB отключён во время проверки.");
      setVerified(true);setStep(copied?4:3);
      setNotice("MicroPython отвечает. Проверка прервала текущее приложение; запуск espOS проверим отдельно.");
    });
  }
  async function flash() {
    if(!s3 || !prepared || !build || !erase) return;
    const selected=build;
    await run("Скачиваем и записываем MicroPython…",async()=>{
      setErase(false);setVerified(false);setCopied(false);setBoot(false);device.clearInfo();
      journal.current=new FlashJournal({Operation:"Beginner flash",Target:"ESP32-S3",Image:selected.filename,Offset:"0x0",Baud:"115200",EraseAll:"true",Memory:memory,Browser:navigator.userAgent});
      event({stage:"download",message:"Официальный стабильный образ"});
      const image=await fetchFirmware(selected.url,(done,total)=>setPct(total?done/total*100:0));
      await flashFirmware(image,{profile:boardProfile("esp32s3"),eraseAll:true,onDetected:chip=>device.setChip(chip),onLog:log,onEvent:event,onProgress:p=>setPct(p.total?p.written/p.total*100:0)});
      setNotice("Запись завершена, но загрузка ещё не проверена. Отпусти BOOT; если порт исчез, выбери его заново, проверь чип и затем ответ MicroPython. Автоматической повторной записи нет.");
    });
  }
  async function install() {
    if(!s3 || !prepared || !verified || !overwrite) return;
    await run("Копируем espOS без экрана…",async()=>{
      setOverwrite(false);setCopied(false);setBoot(false);
      await installBeginner((path,done,total)=>{setTask(`Установка: ${path}`);setPct(total?done/total*100:100);});
      if(serial.status!=="connected") throw new Error("USB отключён: установка не подтверждена.");
      setCopied(true);setStep(4);
      setNotice("Файлы и профиль проверены. Дисплей, тач и LAN отключены. Теперь отдельно проверим запуск.");
    });
  }
  async function verifyBoot() {
    if(!s3 || !prepared || !verified || !copied) return;
    await run("Перезапускаем и ждём свежий ответ espOS…",async()=>{
      setBoot(false);await verifyBeginnerBoot();setBoot(true);setStep(5);
    });
  }
  async function demo() {
    if(!s3 || !boot) return;
    await run("Безопасный тест USB…",async()=>{
      const output=await mpy.exec("print('ESPOS_USB_TEST:' + str(2+2))");
      if(output.trim()!=="ESPOS_USB_TEST:4") throw new Error("Ответ теста не совпал. Повтори проверку запуска.");
      setNotice("Плата посчитала 2 + 2 = 4. USB работает; тест ничего не записывал и не включал GPIO.");
    });
  }
  async function reconnect() {
    await run("Выбираем USB-порт…",async()=>{await device.disconnect();await device.connect();if(serial.status!=="connected") throw new Error("Порт не выбран. Проверь кабель данных и выбери плату вручную.");});
  }
  function downloadLog() {
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([journal.current.export()],{type:"text/plain"}));a.download="espos-simple-start-log.txt";a.click();URL.revokeObjectURL(a.href);
  }
  return <div className="mx-auto flex max-w-4xl flex-col gap-5 pb-6">
    <div><p className="font-mono text-xs text-primary">ESP32-S3 DevKitC · USB · без экрана</p><h1 className="mt-2 font-display text-2xl font-semibold">От кабеля до первого ответа платы</h1><p className="mt-2 text-sm text-muted-foreground">Не нужно выбирать адрес записи или настраивать пины. Мастер объяснит каждое действие; ничего не стирается при подключении.</p></div>
    <ol aria-label="Этапы простого старта" className="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-3">{STEPS.map((name,i)=><li key={name} className={cn("bg-card p-3 text-xs",i===step&&"text-primary")}><span className="mr-2 font-mono">{String(i+1).padStart(2,"0")}</span>{name}{i===step&&" · сейчас"}</li>)}</ol>
    <Panel kicker={`0${step+1}`} title={STEPS[step]!}><div className="flex flex-col gap-4 p-4 sm:p-6">
      {step===0&&<>
        <p className="text-sm">Нужны плата <b>ESP32-S3 DevKitC</b>, ПК с Chrome/Edge и USB-кабель с передачей данных. Экран, датчики и другие внешние модули пока отсоедини при отключённом питании. Не соединяй неизвестные контакты.</p>
        <Notice tone="warning">Это экспериментальная версия: реальные платы ещё требуют проверки. Сохрани важные файлы заранее. Для USB нужен localhost или HTTPS; телефон пока не подходит для этого мастера.</Notice>
        <label className="flex items-start gap-2 text-sm"><input aria-label="Подготовка платы" type="checkbox" disabled={busy} checked={prepared} onChange={e=>setPrepared(e.target.checked)}/>Я сверил модель DevKitC, отключил внешние модули и подготовил кабель данных.</label>
        <ActionButton tone="primary" disabled={!prepared||busy||!device.supported} onClick={()=>setStep(1)} className="self-start">Начать подключение</ActionButton>
      </>}
      {step===1&&<>
        <p className="text-sm">Подключи плату. Если есть USB–UART разъём, начни с него. В окне браузера выбери порт этой платы; при сомнении отключи другие платы.</p>
        <ActionButton disabled={busy||!device.supported} onClick={reconnect} className="self-start">{connected?"Выбрать другой USB-порт":"Выбрать USB-порт платы"}</ActionButton>
        <Notice tone="info">Проверка ROM перезапустит плату, но не сотрёт память, не запишет прошивку и не загрузит RAM-stub. USB VID/PID не доказывает модель чипа.</Notice>
        <ActionButton tone="primary" disabled={!connected||busy||!prepared} onClick={probe} className="self-start">Проверить чип без записи</ActionButton>
      </>}
      {step===2&&<>
        <p className="text-sm">MicroPython — основа для espOS. Если он уже установлен, можно сначала проверить его и пропустить стирание. Проверка прервёт текущее приложение.</p>
        <ActionButton disabled={!s3||busy} onClick={checkMicroPython} className="self-start">Проверить установленный MicroPython</ActionButton>
        <div className="border-t border-border pt-4"><h3 className="mb-3 font-display text-sm">Если MicroPython нужно установить</h3>
          <label className="flex flex-col gap-2 text-sm">Память — по паспорту или маркировке модуля
            <select aria-label="Память для простого старта" disabled={busy} value={memory} onChange={e=>{setMemory(e.target.value as MemoryChoice);setErase(false);}} className="h-10 w-full border border-border bg-background px-2">
              <option value="unknown">Не знаю — запись заблокирована</option><option value="standard">Flash ≥ 4 MiB; без PSRAM или Quad PSRAM</option><option value="octal">Flash ≥ 4 MiB; Octal PSRAM</option>
            </select>
          </label>
          <p className="mt-2 text-xs text-muted-foreground">Надпись ESP32-S3 недостаточна. Найди полную маркировку на металлическом модуле и сверь паспорт производителя. Объём RAM не определяет её тип. Если не уверен — сохрани фото маркировки и не выбирай наугад.</p>
          <a href="https://micropython.org/download/ESP32_GENERIC_S3/" target="_blank" rel="noreferrer" className="mt-2 block text-xs text-primary underline">Официальные требования MicroPython: standard / Octal</a>
        </div>
        {builds.isError&&<Notice tone="error">Список прошивок не получен: {errorText(builds.error)}<ActionButton disabled={busy} onClick={()=>void builds.refetch()}>Обновить список сборок</ActionButton></Notice>}
        {builds.isLoading&&<p className="text-xs">Получаем список официальных стабильных сборок…</p>}
        {memory!=="unknown"&&!builds.isLoading&&!builds.isError&&!build&&<Notice tone="warning">Подходящая стабильная сборка не найдена. Запись заблокирована; не подменяем её другим вариантом.</Notice>}
        {build&&<Notice tone="info">Автоматически выбрана {build.version}: <span className="break-all">{build.filename}</span>. Адрес 0x0, скорость 115200. Совместимость с твоим модулем ещё нужно проверить запуском.</Notice>}
        <label className="flex items-start gap-2 text-sm text-warning"><input aria-label="Подтверждение стирания новичок" disabled={busy||!build||!s3} type="checkbox" checked={erase} onChange={e=>setErase(e.target.checked)}/>Подтверждаю выбранный тип памяти и полное стирание: прежняя прошивка, файлы и сетевые настройки будут потеряны. Резервная копия сохранена или данные не нужны.</label>
        <ActionButton tone="warning" disabled={!s3||!build||!erase||busy} onClick={flash} className="h-auto min-h-8 self-start py-2">Стереть и установить MicroPython</ActionButton>
      </>}
      {step===3&&<>
        <p className="text-sm">Установим приложения и профиль «без экрана». GPIO дисплея и тача не активируются. LAN будет отключён, даже если ранее был настроен. Другие файлы не удаляем, но пути пакета перезаписываем.</p>
        <label className="flex items-start gap-2 text-sm text-warning"><input aria-label="Подтверждение установки новичок" type="checkbox" checked={overwrite} disabled={busy||!s3||!verified} onChange={e=>setOverwrite(e.target.checked)}/>Разрешаю заменить файлы espOS, /config.py и /network_config.py. Прежние настройки дисплея и LAN будут заменены; важные файлы сохранены.</label>
        <ActionButton tone="primary" disabled={!s3||!verified||!overwrite||busy} onClick={install} className="self-start">Установить espOS без экрана</ActionButton>
      </>}
      {step===4&&<>
        <p className="text-sm">Отпусти BOOT. Мастер выполнит Soft reset и дождётся нового сообщения запуска espOS. Экран не нужен: ответ придёт по USB. Копирование файлов не доказывает успешную загрузку.</p>
        <ActionButton tone="primary" disabled={!s3||!verified||!copied||busy} onClick={verifyBoot} className="self-start">Перезапустить и проверить espOS</ActionButton>
      </>}
      {step===5&&<>
        {boot?<Notice tone="success">Свежий запуск espOS без экрана подтверждён по USB. Дисплей, тач и LAN отключены.</Notice>:<Notice tone="warning">После потери USB запуск нужно подтвердить заново. Прошивать повторно ради подключения не нужно.</Notice>}
        <p className="text-sm">Первое действие — попросить плату посчитать 2 + 2. Без записи файлов, включения светодиодов и неизвестных GPIO.</p>
        <ActionButton tone="primary" disabled={!s3||!boot||busy} onClick={demo} className="self-start">Выполнить первый USB-тест</ActionButton>
        <p className="text-sm text-muted-foreground">В расширенном режиме доступны файлы и REPL. Экран подключай позже по проверенной схеме при снятом питании. Wi-Fi — отдельный этап; мастер его не включает.</p><Link href="/guide" className="text-sm text-primary underline">Инструкция и подключение экрана</Link>
      </>}
      {!device.supported&&<Notice tone="warning">WebSerial недоступен. Открой эту страницу в Chrome/Edge на ПК через HTTPS или localhost.</Notice>}
      {step>=2&&!s3&&<Notice tone="warning">Нужна свежая проверка ESP32-S3 в текущем USB-подключении.<ActionButton disabled={busy} onClick={()=>setStep(1)}>Вернуться к проверке платы</ActionButton></Notice>}
      {step>=3&&!verified&&s3&&<ActionButton disabled={busy} onClick={checkMicroPython}>Проверить MicroPython после переподключения</ActionButton>}
      {step===5&&!boot&&verified&&s3&&<ActionButton disabled={busy} onClick={()=>setStep(4)}>Повторить проверку запуска</ActionButton>}
      {task&&<><p aria-live="polite" className="break-all font-mono text-xs text-primary">{task}</p><ProgressBar value={pct}/><p className="text-xs text-warning">Не отключай питание во время записи. Автоматических повторов нет.</p></>}
      {notice&&<Notice tone="info">{notice}</Notice>}
      {error&&<Notice tone="error">{error}</Notice>}
      {step>0&&<ActionButton disabled={busy} onClick={()=>{setStep(step-1);setError(null);setNotice(null);setErase(false);setOverwrite(false);}} className="self-start">Назад</ActionButton>}
    </div></Panel>
    <FlashRecovery error={error??device.error} stage={journal.current.lastOperationStage} flashMayHaveChanged={journal.current.flashMayHaveChanged} writeCompleted={journal.current.writeCompleted} busy={busy} connected={connected} supported={device.supported} reconnect={reconnect} downloadLog={downloadLog}/>
  </div>;
}