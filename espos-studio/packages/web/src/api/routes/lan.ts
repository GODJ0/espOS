import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { base } from "../__core/app";
import { authorizeBridge, deviceCommand, lanConfig, privateDeviceIP, validateAppPath } from "../services/lan-bridge";

const command = z.discriminatedUnion("op", [
  z.object({ op: z.literal("status") }),
  z.object({ op: z.literal("list"), path: z.string().max(160) }),
  z.object({ op: z.literal("read"), path: z.string().max(160) }),
  z.object({ op: z.literal("write"), path: z.string().max(160), content: z.string().max(16384), revision: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true) }),
  z.object({ op: z.literal("reboot"), confirm: z.literal(true) }),
]);
export const lan = {
  config: base.handler(() => {
    const c = lanConfig();
    return { enabled: c.enabled && privateDeviceIP(c.host) && c.origins.length > 0, device: c.enabled ? c.host : null, protocol: "espos-lan-v2" };
  }),
  command: base.input(z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), command })).handler(async ({ input, context }) => {
    try {
      const config = lanConfig(); authorizeBridge(config, context.headers);
      if ("path" in input.command) validateAppPath(input.command.path, input.command.op === "list");
      if (input.command.op === "write" && new TextEncoder().encode(input.command.content).length > 16384) throw new Error("Файл превышает 16 KiB UTF-8.");
      return await deviceCommand(config, input.token, input.command);
    } catch (e) { throw new ORPCError("BAD_REQUEST", { message: e instanceof Error ? e.message : "Wi-Fi operation failed" }); }
  }),
};