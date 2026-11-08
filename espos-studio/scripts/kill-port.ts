// Frees the Studio web port (`bun run kill:port`) on Windows, macOS and Linux.
// Windows has no lsof/xargs; Get-NetTCPConnection is also locale-independent,
// unlike parsing netstat's translated state column.
import ports from "../__ports.cjs";

const port = Number(ports.website);
const pids = new Set<number>();
const run = (cmd: string[]) => Bun.spawnSync(cmd).stdout.toString();

if (process.platform === "win32") {
  const out = run(["powershell", "-NoProfile", "-Command",
    `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`]);
  for (const pid of out.split(/\s+/)) if (Number(pid) > 0) pids.add(Number(pid));
  for (const pid of pids) run(["taskkill", "/F", "/PID", String(pid)]);
} else {
  for (const pid of run(["lsof", "-t", "-i", `:${port}`]).split(/\s+/)) if (Number(pid) > 0) pids.add(Number(pid));
  for (const pid of pids) process.kill(pid, "SIGKILL");
}

console.log(pids.size ? `Port ${port}: stopped PID ${[...pids].join(", ")}` : `Port ${port} is free`);
