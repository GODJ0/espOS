import { base } from "../__core/app";
import { z } from "zod";
import { BOARD_IDS, boardProfile, type BoardId } from "../../shared/boards";

const ALLOWED_PREFIX = "https://micropython.org/resources/firmware/";

export interface FirmwareBuild {
  version: string;
  date: string;
  filename: string;
  url: string;
  /** Full bootloader-first images. Flash offset depends on chip family. */
  variant: "full";
  board: BoardId;
  flavour: string;
  flashOffset: number;
}

/**
 * Lists the official MicroPython builds for an allowlisted chip family by reading micropython.org's
 * download page server-side — the browser can't fetch it directly (no CORS),
 * which is also why `/api/firmware/download` proxies the .bin itself.
 */
export const firmware = {
  list: base.input(z.object({ board: z.enum(BOARD_IDS) })).handler(async ({ input }): Promise<FirmwareBuild[]> => {
    const profile = boardProfile(input.board);
    const res = await fetch(`https://micropython.org/download/${profile.firmwareBoard}/`, { headers: { "user-agent": "espOS-Studio" } });
    if (!res.ok) throw new Error(`micropython.org returned ${res.status}`);
    const html = await res.text();

    const builds = new Map<string, FirmwareBuild>();
    const re = /href="(\/resources\/firmware\/([A-Za-z0-9_.-]+\.bin))"/g;
    for (const m of html.matchAll(re)) {
      const filename = m[2]!;
      if (builds.has(filename) || !filename.startsWith(profile.firmwareBoard + "-")) continue;
      const suffix = filename.slice(profile.firmwareBoard.length);
      const meta = /^(?:-(?<flavour>[A-Z0-9_]+))?-(?<date>\d{8})-v(?<version>\d+(?:\.\d+)+)\.bin$/.exec(suffix);
      // Only stable releases (skip nightly "preview" builds) and only full images.
      if (!meta?.groups || filename.endsWith(".app-bin") || filename.includes("preview")) continue;
      builds.set(filename, {
        version: meta.groups.flavour ? `v${meta.groups.version} (${meta.groups.flavour})` : `v${meta.groups.version}`,
        date: meta.groups.date!,
        filename,
        url: `https://micropython.org${m[1]!}`,
        variant: "full",
        board: input.board,
        flavour: meta.groups.flavour ?? "standard",
        flashOffset: profile.flashOffset,
      });
    }

    return [...builds.values()]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 16);
  }),
};

/** Handler for the plain-HTTP proxy route registered in src/api/index.ts. */
export async function proxyFirmwareDownload(url: string | undefined): Promise<Response> {
  if (!url || !url.startsWith(ALLOWED_PREFIX) || !/^https:\/\/micropython\.org\/resources\/firmware\/[A-Za-z0-9_.-]+\.bin$/.test(url)) {
    return new Response(JSON.stringify({ error: "url must be a micropython.org firmware resource" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const upstream = await fetch(url, { redirect: "error", headers: { "user-agent": "espOS-Studio" } });
  if (!upstream.ok || !upstream.body) {
    return new Response(JSON.stringify({ error: `upstream returned ${upstream.status}` }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "public, max-age=86400",
    },
  });
}
