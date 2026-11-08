import { expect, test, mock } from "bun:test";
import type { FirmwareBuild } from "../packages/web/src/api/routes/firmware";
const writes: {path:string;content:string}[]=[];
let failPath="", response="", resets=0;
const dataListeners=new Set<(data:Uint8Array)=>void>();
const statusListeners=new Set<(status:string)=>void>();
mock.module("../packages/web/src/web/lib/mpy",()=>({mpy:{
  async writeFile(path:string,content:string,progress?:(done:number,total:number)=>void){writes.push({path,content});if(path===failPath)throw new Error("USB failed");progress?.(content.length,content.length);},
  async exec(code:string){return code.includes("_c={}") ? response : "";},
  async softReset(){resets++;for(const fn of dataListeners)fn(new TextEncoder().encode(response));},
}}));
mock.module("../packages/web/src/web/lib/serial",()=>({serial:{onData(fn:(data:Uint8Array)=>void){dataListeners.add(fn);return()=>dataListeners.delete(fn);},onStatus(fn:(status:string)=>void){statusListeners.add(fn);return()=>statusListeners.delete(fn);}}}));
const { beginnerBuild, headlessConfig, installBeginner, bootEvidence, verifyBeginnerBoot }=await import("../packages/web/src/web/lib/beginner");
const { esposFiles, esposFileList, ESPOS_VERSION }=await import("../packages/web/src/web/lib/espos-files");
const build=(flavour:string,date="20260824",board="esp32s3",version="v1.29.0"):FirmwareBuild=>({flavour,date,board:board as FirmwareBuild["board"],version,flashOffset:0,variant:"full",filename:"x.bin",url:"https://micropython.org/resources/firmware/x.bin"});
test("unknown memory, other chips and wrong variant never silently default",()=>{
  const builds=[build("standard"),build("SPIRAM_OCT","20260824","esp32s3","v1.29.0 (SPIRAM_OCT)"),build("standard","20260406","esp32s3","v1.28.0")];
  expect(beginnerBuild(builds,"unknown")).toBeNull();
  expect(beginnerBuild(builds,"standard")?.version).toBe("v1.29.0");
  expect(beginnerBuild(builds,"octal")?.flavour).toBe("SPIRAM_OCT");
  expect(beginnerBuild([build("standard")],"octal")).toBeNull();
  expect(beginnerBuild([build("standard","20260824","esp32c3"),build("standard","20260824","esp32s3","v1.30.0-preview")],"standard")).toBeNull();
  expect(beginnerBuild([{...build("standard"),flashOffset:4096}],"standard")).toBeNull();
});
test("headless profile disables GPIO peripherals without changing other config",()=>{
  const source=esposFiles["/config.py"]!;
  const output=headlessConfig(source);
  expect(output).toContain("DISPLAY_ENABLED = False");expect(output).toContain("TOUCH_ENABLED = False");expect(output).toContain("TFT_BL   = None");
  expect(()=>headlessConfig("DISPLAY_ENABLED = True")).toThrow("TOUCH_ENABLED");
});
test("install disables existing LAN first, writes bundled files, verifies profile, no reset",async()=>{
  writes.length=0;failPath="";resets=0;response=JSON.stringify({version:ESPOS_VERSION,display:false,touch:false,lan:false});
  await installBeginner(()=>{});
  expect(writes[0]?.path).toBe("/network_config.py");expect(writes[0]?.content).not.toContain("PAIRING_TOKEN");
  expect(writes.length).toBe(esposFileList.length+1);expect(writes.find(f=>f.path==="/config.py")?.content).toContain("DISPLAY_ENABLED = False");expect(resets).toBe(0);
});
test("partial install does not reset or retry; failed profile rejects",async()=>{
  writes.length=0;failPath="/config.py";
  await expect(installBeginner(()=>{})).rejects.toThrow("USB failed");
  expect(writes.filter(f=>f.path===failPath).length).toBe(1);expect(resets).toBe(0);
  failPath="";response=JSON.stringify({version:ESPOS_VERSION,display:true,touch:false,lan:false});
  await expect(installBeginner(()=>{})).rejects.toThrow("не подтверждена");expect(resets).toBe(0);
});
test("boot requires fresh reset, correct version, ready marker and no traceback",()=>{
  const ready=`espOS ${ESPOS_VERSION} on espOS\r\nespOS: ready / headless / USB\r\n`;
  expect(bootEvidence(ready)).toBe(false);
  expect(bootEvidence("MPY: soft reboot\r\n"+ready)).toBe(true);
  expect(bootEvidence("MPY: soft reboot\n"+ready+"Traceback")).toBe(false);
  expect(bootEvidence("MPY: soft reboot\n"+ready.replace(ESPOS_VERSION,"old"))).toBe(false);
  expect(bootEvidence("MPY: soft reboot\n"+ready+"MPY: soft reboot\n")).toBe(false);
});
test("boot verification observes new output, releases listeners, no retry",async()=>{
  response=`MPY: soft reboot\r\nespOS ${ESPOS_VERSION} on espOS\r\nespOS: ready / headless / USB\r\n`;
  resets=0;await verifyBeginnerBoot();expect(resets).toBe(1);expect(dataListeners.size).toBe(0);expect(statusListeners.size).toBe(0);
  response="Traceback: failed";await expect(verifyBeginnerBoot()).rejects.toThrow("Ошибка");expect(resets).toBe(2);expect(dataListeners.size).toBe(0);
});