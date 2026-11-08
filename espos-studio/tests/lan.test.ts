import { expect, test } from "bun:test";
import { createHmac, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { authorizeBridge, deviceCommand, privateDeviceIP, validateAppPath } from "../packages/web/src/api/services/lan-bridge";

const config = { enabled: true, host: "192.168.1.80", origins: ["http://localhost:4200"] };
const token = "a1".repeat(32), nonce = "12".repeat(16);
const key = (purpose:string) => createHmac("sha256",Buffer.from(token,"hex")).update(`espos-lan-v2/${purpose}`).digest();
function envelope(data:unknown,purpose:string,prefix:string) {
  const payload = JSON.stringify(data);
  return {payload,signature:createHmac("sha256",key(purpose)).update(prefix+payload).digest("hex")};
}
function challenge(url:string) {
  return envelope({protocol:"espos-lan-v2",client:new URL(url).searchParams.get("client"),nonce,expiresIn:15},"challenge","challenge\n");
}
function reply(body:string,status=200,data:unknown={accepted:true},override?:string) {
  return Response.json(envelope(data,"response",override ?? `response\n${nonce}\n${createHash("sha256").update(body).digest("hex")}\n${status}\n`),{status});
}
test("LAN bridge is opt-in and exact-origin, fixed private IPv4 only", () => {
  for (const host of ["127.0.0.1","169.254.169.254","8.8.8.8","localhost","192.168.1.80:90","192.168.1.255","10.0.0.0","10.0.0.999"]) expect(privateDeviceIP(host)).toBe(false);
  for (const host of ["10.0.0.8","172.16.0.8","192.168.1.80"]) expect(privateDeviceIP(host)).toBe(true);
  expect(()=>authorizeBridge({...config,enabled:false},new Headers({origin:config.origins[0]!}))).toThrow("выключен");
  expect(()=>authorizeBridge(config,new Headers())).toThrow("Origin");
  expect(()=>authorizeBridge(config,new Headers({origin:"https://evil.example"}))).toThrow("Origin");
  authorizeBridge(config,new Headers({origin:config.origins[0]!}));
});
test("core paths, traversal and binary files blocked", () => {
  for(const path of ["/config.py","/apps/../x.py","/apps/hello/.x.py","/apps/hello/a.bin","/apps//a/app.py"]) expect(()=>validateAppPath(path)).toThrow();
  validateAppPath("/apps",true);validateAppPath("/apps/hello/app.py");
});
test("bridge signs exact body using one-use nonce; no token forwarded", async () => {
  const calls: {url:string;init?:RequestInit}[]=[];
  const fetcher = (async (url: string | URL | Request, init?:RequestInit)=>{calls.push({url:String(url),init});return calls.length===1 ? Response.json(challenge(String(url))) : reply(String(init?.body));}) as typeof fetch;
  await deviceCommand(config,token,{op:"reboot",confirm:true},fetcher);
  expect(calls.length).toBe(2);expect(calls[0]!.url).toMatch(/^http:\/\/192\.168\.1\.80:8765\/espos\/v2\/challenge\?client=[a-f0-9]{32}$/);
  const body=String(calls[1]!.init!.body);const headers=calls[1]!.init!.headers as Record<string,string>;
  expect(headers["x-espos-signature"]).toBe(createHmac("sha256",key("request")).update("request\n"+nonce+"\n"+body).digest("hex"));
  expect(JSON.stringify(calls)).not.toContain(token);expect(calls[1]!.init!.redirect).toBe("error");
});
test("failed write is not retried and releases bridge lock",async()=>{
  let count=0;
  const fetcher=(async(url:string | URL | Request)=>{count++;if(count%2===1)return Response.json(challenge(String(url)));throw new Error("network gone");}) as typeof fetch;
  await expect(deviceCommand(config,"a1".repeat(32),{op:"write"},fetcher)).rejects.toThrow("не повторяются");expect(count).toBe(2);
  await expect(deviceCommand(config,"a1".repeat(32),{op:"status"},fetcher)).rejects.toThrow();expect(count).toBe(4);
});
test("oversized response rejected before command",async()=>{
  let calls=0;const fetcher=(async()=>{calls++;return new Response("x".repeat(65537));}) as typeof fetch;
  await expect(deviceCommand(config,"a1".repeat(32),{op:"status"},fetcher)).rejects.toThrow("64 KiB");expect(calls).toBe(1);
});
for (const mode of ["unsigned-v1","tampered-payload","tampered-signature","wrong-client","stale-client","wrong-protocol","wrong-expiry"]) {
  test(`challenge rejected before RPC: ${mode}`,async()=>{
    let count=0;
    const fetcher=(async(url:string | URL | Request)=>{
      count++; const signed=challenge(String(url));const data=JSON.parse(signed.payload);
      if(mode==="unsigned-v1") return Response.json({protocol:"espos-lan-v1",nonce});
      if(mode==="tampered-payload") signed.payload+=" ";
      if(mode==="tampered-signature") signed.signature="0".repeat(64);
      if(mode==="wrong-client" || mode==="stale-client") data.client="00".repeat(16);
      if(mode==="wrong-protocol") data.protocol="espos-lan-v1";
      if(mode==="wrong-expiry") data.expiresIn=999;
      return Response.json(mode.startsWith("tampered")?signed:envelope(data,"challenge","challenge\n"));
    }) as typeof fetch;
    await expect(deviceCommand(config,token,{op:"write"},fetcher)).rejects.toThrow();expect(count).toBe(1);
  });
}
for (const mode of ["payload","unsigned","nonce","hash","status"]) {
  test(`RPC response substitution rejected without retry: ${mode}`,async()=>{
    let count=0;
    const fetcher=(async(url:string | URL | Request,init?:RequestInit)=>{
      count++;if(count===1)return Response.json(challenge(String(url)));
      const body=String(init?.body);let prefix=`response\n${nonce}\n${createHash("sha256").update(body).digest("hex")}\n200\n`;
      if(mode==="nonce") prefix=prefix.replace(nonce,"0".repeat(32));
      if(mode==="hash") prefix=prefix.replace(createHash("sha256").update(body).digest("hex"),"0".repeat(64));
      if(mode==="status") prefix=prefix.replace("\n200\n","\n400\n");
      const signed=envelope({accepted:true},"response",prefix);
      if(mode==="payload") signed.payload=JSON.stringify({accepted:false});
      return Response.json(mode==="unsigned"?{accepted:true}:signed);
    }) as typeof fetch;
    await expect(deviceCommand(config,token,{op:"write"},fetcher)).rejects.toThrow("Подпись");expect(count).toBe(2);
  });
}
test("signed errors checked before reporting board failure",async()=>{
  let count=0;
  const fetcher=(async(url:string | URL | Request,init?:RequestInit)=>{count++;return count%2===1 ? Response.json(challenge(String(url))) : reply(String(init?.body),403,{error:"Authentication failed"});}) as typeof fetch;
  await expect(deviceCommand(config,token,{op:"status"},fetcher)).rejects.toThrow("подпись проверена");
  await expect(deviceCommand(config,token,{op:"status"},fetcher)).rejects.toThrow("HTTP 403");expect(count).toBe(4);
});
test("rotated token cannot verify old board challenge",async()=>{
  let count=0;const fetcher=(async(url:string | URL | Request)=>{count++;return Response.json(challenge(String(url)));}) as typeof fetch;
  await expect(deviceCommand(config,"b2".repeat(32),{op:"status"},fetcher)).rejects.toThrow("Подпись");expect(count).toBe(1);
});
test("actual Python envelopes interoperate with Node bridge (UTF-8)",async()=>{
  let count=0;
  const fetcher=(async(url:string | URL | Request,init?:RequestInit)=>{
    count++;
    const script = `import sys,json\nsys.path.insert(0,'../espOS/firmware/lib')\nfrom espos.net_protocol import Protocol,sha\np=Protocol('${token}',random=lambda n:bytes.fromhex('${nonce}'))\nclient=sys.argv[1]\nbody=sys.argv[2].encode()\nif client: result=p.challenge(client)\nelse:\n p.nonces['${nonce}']=p.clock()+15\n p.authenticate('${nonce}',sys.argv[3],body)\n result=p.response(200,{'accepted':True,'text':'Привет'},'${nonce}',sha(body))\nprint(json.dumps(result))`;
    const headers=init?.headers as Record<string,string> | undefined;
    const result=spawnSync("python",["-c",script,new URL(String(url)).searchParams.get("client") ?? "",String(init?.body ?? ""),headers?.["x-espos-signature"] ?? ""],{encoding:"utf8"});
    expect(result.status).toBe(0);
    return Response.json(JSON.parse(result.stdout));
  }) as typeof fetch;
  const data=await deviceCommand(config,token,{op:"write",content:"Привет\n"},fetcher);
  expect(data.text).toBe("Привет");expect(count).toBe(2);
});