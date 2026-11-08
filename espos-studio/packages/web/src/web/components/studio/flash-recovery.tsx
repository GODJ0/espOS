import { diagnose, STAGE_LABELS, type FlashStage } from "../../lib/flash-diagnostics";
import { ActionButton, Notice } from "./primitives";

export function FlashRecovery({ error, stage, flashMayHaveChanged, writeCompleted, busy, connected, supported, reconnect, downloadLog }: {
  error: string | null; stage: FlashStage; flashMayHaveChanged: boolean; writeCompleted: boolean;
  busy: boolean; connected: boolean; supported: boolean; reconnect: () => Promise<void>; downloadLog: () => void;
}) {
  const diagnosis = error ? diagnose(error, stage) : null;
  return <section className="flex flex-col gap-3 border border-border p-3" aria-label="Диагностика и восстановление">
    <h3 className="font-display text-xs uppercase tracking-widest">Диагностика и восстановление</h3>
    <p className="font-mono text-[11px] text-muted-foreground">Последний этап: {STAGE_LABELS[stage]}</p>
    {diagnosis && <>
      <Notice tone="error"><b>{diagnosis.title}</b><br /><span className="font-mono">{diagnosis.code}</span><br /><span className="break-words">{error}</span></Notice>
      <ul className="list-disc pl-4 text-xs leading-relaxed text-muted-foreground">{diagnosis.steps.map(s => <li key={s}>{s}</li>)}</ul>
    </>}
    {flashMayHaveChanged && !writeCompleted && <Notice tone="warning">Запись не подтверждена. Flash мог быть стёрт или записан частично. Переподключение не восстановит его содержимое. Сначала восстанови ROM-связь; новую запись запускай только вручную после проверки образа.</Notice>}
    {writeCompleted && <Notice tone="info">writeFlash завершён. Это не подтверждает загрузку MicroPython, работу PSRAM или espOS. Если USB исчез — выбери новый порт; повторно прошивать ради подключения не нужно.</Notice>}
    <details>
      <summary className="cursor-pointer text-xs text-primary">Как вернуть плату в ROM-загрузчик</summary>
      <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
        <li>Дождись окончания операции. Не отключай питание во время стирания/записи.</li>
        <li>Закрой другие программы и вкладки, использующие USB-порт. Проверь кабель данных и питание.</li>
        <li>Если на плате есть BOOT и RST/EN: зажми BOOT, нажми и отпусти RST/EN, затем отпусти BOOT. Для другой платы следуй её документации; не замыкай неизвестные GPIO.</li>
        <li>На native USB порт может измениться. Нажми «Выбрать USB-порт заново» и выбери появившуюся плату. Если есть USB–UART, попробуй его.</li>
        <li>Запусти только «Определить чип». После успешной связи сверь семейство, модуль и полный образ.</li>
        <li>Для обычной загрузки отпусти BOOT и нажми RST/EN. Проверку MicroPython запускай отдельно через «Статус REPL» — она прерывает приложение.</li>
      </ol>
    </details>
    <div className="flex flex-wrap gap-2">
      <ActionButton disabled={busy || !supported} onClick={reconnect}>{connected ? "Выбрать USB-порт заново" : "Выбрать USB-порт"}</ActionButton>
      <ActionButton disabled={busy} onClick={downloadLog}>Скачать журнал диагностики</ActionButton>
    </div>
    <p className="text-[11px] text-muted-foreground">Переподключение только открывает порт: без сброса, стирания, записи и автоматического REPL-опроса. Журнал остаётся локально, содержит USB VID/PID и данные браузера, но не включает REPL автоматически. Проверь его перед отправкой.</p>
    <a className="text-xs text-primary underline" href="https://docs.espressif.com/projects/esptool/en/latest/esp32/troubleshooting.html" target="_blank" rel="noreferrer">Официальная диагностика Espressif</a>
  </section>;
}