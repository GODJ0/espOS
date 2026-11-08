export type FlashStage = "idle" | "download" | "validate" | "port" | "rom" | "guard" | "write" | "reset" | "reconnect" | "complete";
export const STAGE_LABELS: Record<FlashStage, string> = {
  idle: "Ожидание", download: "Загрузка образа", validate: "Проверка образа", port: "Передача USB-порта",
  rom: "Соединение с ROM", guard: "Проверка семейства", write: "Стирание / запись flash",
  reset: "Сброс платы", reconnect: "Возврат USB-порта", complete: "Операция завершена",
};
export interface FlashEvent { stage: FlashStage; message: string; warning?: boolean }
export type EventSink = (event: FlashEvent) => void;
export interface Diagnosis { code: string; title: string; steps: string[] }
export function diagnose(raw: string, stage: FlashStage): Diagnosis {
  if (/Образ для|Подключён .*выбран|Запись запрещена|Некорректный заголовок|bootloader-first/.test(raw)) return {
    code: "IMAGE_OR_FAMILY", title: "Образ или семейство не совпадает",
    steps: ["Сверь ROM-семейство с выбранным профилем.", "Выбери полный официальный образ под свой модуль. Не используй app-only .bin.", "Если плата осталась в загрузчике — нажми RST."],
  };
  if (/secure download|security|secure boot|flash encrypt/i.test(raw)) return {
    code: "SECURITY_MODE", title: "Ограничения безопасности чипа",
    steps: ["Не меняй eFuse, Secure Boot или шифрование ради обхода ошибки.", "Проверь процедуру прошивки производителя платы. Этот интерфейс не обходит защиту."],
  };
  if (/notfound|no port selected|cancel|отмен/i.test(raw)) return { code: "PORT_NOT_SELECTED", title: "Порт не выбран", steps: ["Отмена выбора порта не меняет прошивку.", "Подключи кабель с передачей данных и выбери порт платы заново."] };
  if (/access|denied|permission|securityerror|networkerror.*open|already open|busy|занят|failed to open/i.test(raw)) return {
    code: "PORT_ACCESS", title: "Нет доступа к USB-порту",
    steps: ["Закрой Serial Monitor, Thonny, mpremote и другие вкладки с этой платой.", "На Linux проверь права доступа к последовательному порту.", "Открой Studio в Chrome/Edge через HTTPS или localhost и выбери порт заново."],
  };
  if (stage === "download" || /Download failed|fetch|HTTP|загрузк.*образ/i.test(raw)) return {
    code: "DOWNLOAD", title: "Образ не удалось загрузить",
    steps: ["Проверь интернет и доступность micropython.org.", "Скачай полный .bin с официальной страницы и выбери «Свой .bin».", "Загрузка не стирает flash. Повторная прошивка не запускается автоматически."],
  };
  if (/wrong boot|no serial data|failed to connect|timed? ?out|timeout|packet header|sync/i.test(raw) && stage !== "write") return {
    code: "ROM_CONNECTION", title: "ROM-загрузчик не ответил — вероятная причина",
    steps: ["Проверь выбранный порт, кабель данных и стабильность питания.", "Войди в загрузчик кнопками BOOT/RST по инструкции ниже.", "Подключись к появившемуся порту и сначала повтори только определение чипа."],
  };
  if (/USB|disconnect|device.*lost|NetworkError|read|write|порт/i.test(raw) || stage === "write" || stage === "reconnect") return {
    code: "USB_CONNECTION", title: "Связь с платой нарушена — вероятная причина",
    steps: ["Проверь кабель и питание, исключи USB-хаб. Если есть USB–UART, попробуй его.", "Native USB при сбросе может появиться как новый порт. Выбери его вручную.", "Переподключение не повторяет запись. Сначала проверь ROM-связь и загрузку платы."],
  };
  return { code: "UNKNOWN", title: "Причина пока не установлена", steps: ["Сохрани журнал с исходной ошибкой.", "Проверь кабель, питание и режим загрузчика. Не меняй eFuse и не стирай flash вслепую."] };
}

/** Bounded, local-only evidence. Frozen metadata survives target changes and lost USB. */
export class FlashJournal {
  readonly started = new Date().toISOString();
  readonly metadata: Record<string, string>;
  stage: FlashStage = "idle";
  lastOperationStage: FlashStage = "idle";
  flashMayHaveChanged = false;
  writeCompleted = false;
  private text = "";
  constructor(metadata: Record<string, string>) { this.metadata = { ...metadata }; }
  append(message: string) { this.text = (this.text + `[${new Date().toISOString()}] ${message}\n`).slice(-64000); }
  event(event: FlashEvent) {
    this.stage = event.stage;
    if (event.stage !== "reconnect") this.lastOperationStage = event.stage;
    if (event.stage === "write") this.flashMayHaveChanged = true;
    if (event.stage === "reset") this.writeCompleted = true;
    this.append(`${event.warning ? "WARNING " : ""}${event.stage}: ${event.message}`);
  }
  export() {
    return `espOS Studio diagnostic session\nStarted: ${this.started}\n${Object.entries(this.metadata).map(([k,v]) => `${k}: ${v}`).join("\n")}\nStage: ${this.stage}\nLast operation stage: ${this.lastOperationStage}\nFlash may have changed: ${this.flashMayHaveChanged}\nWrite completed: ${this.writeCompleted}\nHardware validation: pending\nREPL contents: not included\n\n${this.text}`;
  }
}