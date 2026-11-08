import type { FirmwareBuild } from "../../api/routes/firmware";
import { esposFiles, esposFileList, ESPOS_VERSION } from "./espos-files";
import { mpy } from "./mpy";
import { serial } from "./serial";

export type MemoryChoice = "unknown" | "standard" | "octal";
export function beginnerBuild(builds: FirmwareBuild[], memory: MemoryChoice): FirmwareBuild | null {
  if (memory === "unknown") return null;
  return builds.filter(b => b.board === "esp32s3" && b.variant === "full" && b.flashOffset === 0 && b.flavour === (memory === "octal" ? "SPIRAM_OCT" : "standard") && /^v\d+\.\d+\.\d+(?: \(SPIRAM_OCT\))?$/.test(b.version))
    .sort((a,b) => b.date.localeCompare(a.date) || b.version.localeCompare(a.version,undefined,{numeric:true}))[0] ?? null;
}
export function headlessConfig(source: string): string {
  for (const name of ["DISPLAY_ENABLED", "TOUCH_ENABLED"]) {
    const pattern = new RegExp(`^${name} = True[^\\n]*$`, "m");
    if (!pattern.test(source)) throw new Error(`Профиль ${name} не найден; установка остановлена.`);
    source = source.replace(pattern, `${name} = False # Simple start: no external modules`);
  }
  return source;
}
export const LAN_DISABLED = "# Simple start: LAN disabled; configure later over USB.\nENABLED = False\n";
export async function installBeginner(onFile: (path: string, done: number, total: number) => void) {
  // Validate profile before overwriting any device files.
  const config = headlessConfig(esposFiles["/config.py"]!);
  // Stop a previously provisioned LAN before any later restart. Explicit UI confirmation covers this overwrite.
  await mpy.writeFile("/network_config.py", LAN_DISABLED);
  for (const path of esposFileList) {
    await mpy.writeFile(path, path === "/config.py" ? config : esposFiles[path]!, (done,total) => onFile(path,done,total));
  }
  await mpy.exec("import os\nopen('/apps/__init__.py','a').close()\nfor _d in os.listdir('/apps'):\n    try:\n        os.stat('/apps/'+_d+'/app.py')\n        open('/apps/'+_d+'/__init__.py','a').close()\n    except OSError:\n        pass");
  const check = await mpy.exec("import json\n_c={}\nexec(open('/config.py').read(),_c)\n_n={}\nexec(open('/network_config.py').read(),_n)\nprint(json.dumps({'version':_c.get('FIRMWARE_VERSION'),'display':_c.get('DISPLAY_ENABLED'),'touch':_c.get('TOUCH_ENABLED'),'lan':_n.get('ENABLED')}))");
  const result = JSON.parse(check.trim().split("\n").pop() ?? "{}");
  if (result.version !== ESPOS_VERSION || result.display !== false || result.touch !== false || result.lan !== false) throw new Error("Записанная конфигурация не подтверждена. Перезапуск не выполнен.");
}

export function bootEvidence(output: string): boolean {
  const reset = output.lastIndexOf("MPY: soft reboot");
  if (reset < 0) return false;
  const fresh = output.slice(reset);
  return fresh.includes(`espOS ${ESPOS_VERSION} on espOS`) && fresh.includes("espOS: ready / headless / USB") && !fresh.includes("Traceback");
}
/** Fresh reset output, not a file-copy claim or cached REPL log. No automatic reconnect/retry. */
export async function verifyBeginnerBoot(): Promise<void> {
  await new Promise<void>((resolve,reject) => {
    let output = "", settled = false;
    const decoder = new TextDecoder();
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); offData(); offStatus();
      if (error) reject(error); else resolve();
    };
    const offData = serial.onData(chunk => {
      output = (output + decoder.decode(chunk,{stream:true})).slice(-16000);
      if (output.includes("Traceback")) finish(new Error("Ошибка при запуске espOS. Открой расширенный REPL или восстановление BOOT/RST."));
      else if (bootEvidence(output)) finish();
    });
    const offStatus = serial.onStatus(status => { if (status !== "connected") finish(new Error("USB исчез при перезапуске. Выбери порт заново и повтори проверку запуска вручную; повторная прошивка не нужна.")); });
    const timer = setTimeout(() => finish(new Error("Запуск не подтверждён за 12 секунд. Отпусти BOOT, проверь кабель и нажми RST. Не перепрошивай вслепую.")),12000);
    void mpy.softReset().catch(e => finish(e instanceof Error ? e : new Error(String(e))));
  });
}