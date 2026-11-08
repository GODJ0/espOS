/// <reference types="node" />
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface LanConfig { enabled: boolean; host: string; origins: string[] }
export function privateDeviceIP(ip: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const p = ip.split(".").map(Number);
  if (p.some(n => n > 255) || p[3] === 0 || p[3] === 255) return false;
  return p[0] === 10 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1]! >= 16 && p[1]! <= 31);
}
export function lanConfig(): LanConfig {
  return { enabled: process.env.ESPOS_LAN_ENABLED === "true", host: process.env.ESPOS_LAN_DEVICE_IP ?? "", origins: (process.env.ESPOS_LAN_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean) };
}
export function authorizeBridge(config: LanConfig, headers: Headers) {
  if (!config.enabled) throw new Error("LAN bridge выключен. Запусти локальный Studio и включи ESPOS_LAN_ENABLED.");
  if (!privateDeviceIP(config.host)) throw new Error("ESPOS_LAN_DEVICE_IP должен быть конкретным private IPv4 платы.");
  const origin = headers.get("origin");
  if (!origin || !config.origins.includes(origin)) throw new Error("Origin не разрешён. Настрой точный ESPOS_LAN_ORIGINS для локального Studio.");
}
export function validateAppPath(path: string, directory = false) {
  const parts = path.split("/");
  if (path.length > 160 || parts[0] !== "" || parts[1] !== "apps" || parts.length > 7 || parts.slice(2).some(s => !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(s))) throw new Error("Допустимы только пути внутри /apps без .. и скрытых файлов.");
  if (!directory && (parts.length < 4 || !/\.(py|json|txt|md)$/.test(path))) throw new Error("Доступны только текстовые файлы приложений.");
}
async function boundedJSON(response: Response) {
  if (!response.body) throw new Error("Плата вернула пустой ответ.");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 65536) throw new Error("Ответ платы превышает лимит 64 KiB."); chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const data = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  return data;
}
function derivedKey(token: string, purpose: string) { return createHmac("sha256", Buffer.from(token, "hex")).update(`espos-lan-v2/${purpose}`).digest(); }
function signedPayload(envelope: Record<string, unknown>, key: Buffer, prefix: string): Record<string, unknown> {
  if (typeof envelope.payload !== "string" || typeof envelope.signature !== "string" || !/^[a-f0-9]{64}$/.test(envelope.signature)) throw new Error("Подпись ответа отсутствует. Требуется Wi-Fi v2; обнови Studio и пакет платы по USB.");
  const expected = createHmac("sha256", key).update(prefix + envelope.payload).digest();
  if (!timingSafeEqual(expected, Buffer.from(envelope.signature, "hex"))) throw new Error("Подпись ответа не совпадает. Возможна подмена или неверный токен; действие не повторяется. Для write/reboot результат неизвестен — проверь плату по USB.");
  const payload: unknown = JSON.parse(envelope.payload);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Подписанный ответ имеет неверный формат.");
  return payload as Record<string, unknown>;
}
// Per-device serialisation: no competing challenges/write/reboot and no automatic retry.
let busy = false;
export async function deviceCommand(config: LanConfig, token: string, command: Record<string, unknown>, fetcher: typeof fetch = fetch) {
  if (!config.enabled || !privateDeviceIP(config.host)) throw new Error("LAN bridge не настроен.");
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Нужен 32-byte hex токен сопряжения.");
  const body = JSON.stringify(command);
  if (new TextEncoder().encode(body).length > 24576) throw new Error("Запрос превышает 24 KiB; файл должен быть до 16 KiB.");
  if (busy) throw new Error("Плата занята другим Wi-Fi запросом.");
  busy = true;
  try {
    const base = `http://${config.host}:8765/espos/v2`;
    const client = randomBytes(16).toString("hex");
    const challengeResponse = await fetcher(`${base}/challenge?client=${client}`, { redirect: "error", signal: AbortSignal.timeout(8000) });
    const challenge = signedPayload(await boundedJSON(challengeResponse), derivedKey(token, "challenge"), "challenge\n");
    if (!challengeResponse.ok || challenge.protocol !== "espos-lan-v2" || challenge.client !== client || challenge.expiresIn !== 15 || typeof challenge.nonce !== "string" || !/^[a-f0-9]{32}$/.test(challenge.nonce)) throw new Error("Подписанный challenge устарел или не соответствует запросу. Wi-Fi команда не отправлена.");
    const signature = createHmac("sha256", derivedKey(token,"request")).update("request\n" + challenge.nonce + "\n" + body).digest("hex");
    const response = await fetcher(`${base}/rpc`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(8000), headers: { "content-type": "application/json", "x-espos-nonce": challenge.nonce, "x-espos-signature": signature }, body });
    const requestHash = createHash("sha256").update(body).digest("hex");
    const data = signedPayload(await boundedJSON(response), derivedKey(token,"response"), `response\n${challenge.nonce}\n${requestHash}\n${response.status}\n`);
    if (!response.ok) throw new Error(`Плата HTTP ${response.status}: ${String(data.error ?? "ошибка").slice(0,160)} (подпись проверена)`);
    return data;
  } catch (e) {
    // Do not echo token, payload or network credentials through API errors.
    if (e instanceof Error && /^(Плата|Ответ платы|LAN bridge|Запрос|Подпись|Подписанный)/.test(e.message)) throw e;
    throw new Error("Wi-Fi запрос не подтверждён. Проверь питание, IP и сеть. Запись/перезапуск не повторяются автоматически; после сбоя перечитай файл.");
  } finally { busy = false; }
}