export const BOARD_IDS = ["esp32", "esp32s2", "esp32s3", "esp32c2", "esp32c3", "esp32c6"] as const;
export type BoardId = (typeof BOARD_IDS)[number];
export interface BoardProfile {
  id: BoardId;
  label: string;
  firmwareBoard: string;
  imageChipId: number;
  flashOffset: number;
  note: string;
}
export const BOARDS: BoardProfile[] = [
  { id: "esp32", label: "ESP32", firmwareBoard: "ESP32_GENERIC", imageChipId: 0, flashOffset: 0x1000, note: "Обычно USB–UART. Выбирай вариант MicroPython под flash/PSRAM своего модуля." },
  { id: "esp32s2", label: "ESP32-S2", firmwareBoard: "ESP32_GENERIC_S2", imageChipId: 2, flashOffset: 0x1000, note: "USB–UART или native USB. Bluetooth отсутствует." },
  { id: "esp32s3", label: "ESP32-S3", firmwareBoard: "ESP32_GENERIC_S3", imageChipId: 9, flashOffset: 0, note: "Для octal PSRAM выбирай SPIRAM_OCT. Распиновка espOS пока только для S3 DevKitC." },
  { id: "esp32c2", label: "ESP32-C2", firmwareBoard: "ESP32_GENERIC_C2", imageChipId: 12, flashOffset: 0, note: "Официальная generic-сборка требует минимум 4 MiB flash и кварц 26 MHz. ROM-определение семейства не подтверждает эти параметры." },
  { id: "esp32c3", label: "ESP32-C3", firmwareBoard: "ESP32_GENERIC_C3", imageChipId: 5, flashOffset: 0, note: "Generic-сборка: обычно минимум 4 MiB flash. USB Serial/JTAG или USB–UART." },
  { id: "esp32c6", label: "ESP32-C6", firmwareBoard: "ESP32_GENERIC_C6", imageChipId: 13, flashOffset: 0, note: "Официальная generic-сборка MicroPython. Поддержку периферии проверяй для своего релиза." },
];
export function boardProfile(id: BoardId): BoardProfile {
  return BOARDS.find((b) => b.id === id)!;
}
export function boardFromChipName(name: string): BoardProfile | null {
  return BOARDS.find((b) => b.label.toUpperCase() === name.toUpperCase()) ?? null;
}
export function formatOffset(n: number): string {
  return "0x" + n.toString(16).padStart(8, "0");
}
/** A conservative full-image header check. Does not validate flash size, signatures or partitions. */
export function validateImage(image: Uint8Array, expected: BoardProfile): void {
  if (image.length < 32 || image[0] !== 0xe9) {
    throw new Error("Нужен полный bootloader-first .bin для выбранного адреса. UF2, ZIP, app-bin и образы с префиксом заполнения не поддерживаются.");
  }
  if (image[1] === 0 || image[1] > 16) throw new Error("Некорректный заголовок ESP image: число сегментов.");
  const id = image[12]! | (image[13]! << 8);
  if (id !== expected.imageChipId) {
    const actual = BOARDS.find((b) => b.imageChipId === id)?.label ?? `chip ID ${id}`;
    throw new Error(`Образ для ${actual}, выбран ${expected.label}. Запись запрещена.`);
  }
}
export function assertChipMatches(chipName: string, expected: BoardProfile): void {
  if (chipName.toUpperCase() !== expected.label.toUpperCase()) {
    throw new Error(`Подключён ${chipName}, выбран ${expected.label}. Flash не стёрт; запись запрещена. Нажми RST, чтобы выйти из загрузчика.`);
  }
}
