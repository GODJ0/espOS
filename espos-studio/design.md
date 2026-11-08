## Social sharing image
OG preview: 1200×630 PNG, near-black engineering grid, oversized espOS Studio wordmark, cyan schematic chip (illustration, not a hardware pinout), Russian USB/setup description. Same palette; clear text at thumbnail size. Open Graph and Twitter large-image metadata share one versioned public asset.

# espOS Studio — Design

Browser-based companion for **espOS** on ESP32-S3. Ships on web (desktop browsers: Chrome/Edge,
WebSerial required). Visual direction: instrument-panel / oscilloscope — near-black background,
thin hairline borders, mono type for anything the device says, one electric cyan accent used only
for live state and primary actions. Job it does: plug in a board → flash MicroPython → install
espOS → edit apps and watch the REPL, without installing a single local tool.

## Brand & Colors

Dark-only (a bench tool, not a marketing site). CSS variables in `packages/web/src/web/styles.css`.

| Token | Value | Use |
|-------|-------|-----|
| background | #08090B | Page background |
| card | #0E1014 | Panels, cards |
| elevated | #14171D | Inputs, table rows, hover |
| foreground | #E7EAEF | Primary text |
| mutedForeground | #8A93A2 | Labels, secondary text |
| border | #1E232C | Hairlines (1px, everywhere) |
| primary (cyan) | #22D3EE | Primary actions, connected state, focus rings |
| success | #4ADE80 | Flash/sync OK |
| warning | #FBBF24 | Erase/overwrite warnings |
| destructive | #F4646A | Disconnect, delete, errors |

Accent is never decorative — cyan means "live device" or "the button that does the thing".

## Typography

- **Display/headings**: Chakra Petch (600/700) — squared technical face, uppercase + wide tracking for section labels.
- **Body/UI**: Archivo (400/500).
- **Mono** (REPL, file paths, code editor, logs): JetBrains Mono (400/500).

Loaded from Google Fonts in `packages/web/index.html`.

## Layout

Single-screen workbench, no scrolling chrome: fixed top status rail (device state, chip, port,
connect/disconnect) + left rail of tool tabs + main panel. Panels are flat: 1px border, no shadows,
no rounded-card grid. Density is deliberate — this is a tool, not a landing page.

## Pages

- **Web — Workbench** (`packages/web/src/web/pages/index.tsx`) — tabs:
  1. **Flash** — pick a MicroPython ESP32-S3 build (listed via API from micropython.org, downloaded
     through the server to dodge CORS) or upload a local `.bin`; erase + write over WebSerial via esptool-js,
     with live progress.
  2. **Install espOS** — one click pushes the bundled espOS tree (`boot.py`, `main.py`, `config.py`,
     `lib/espos/*`, `lib/drivers/*`, `apps/*`) to the device filesystem over the MicroPython raw REPL.
  3. **Files** — device filesystem browser: list/read/write/delete, upload from disk, download to disk.
  4. **Editor** — open a device file, edit, save back, soft-reset and watch it run.
  5. **REPL** — live serial terminal, Ctrl-C / Ctrl-D / soft reset buttons.

## Key flows

1. Connect: `Connect device` → browser port picker → status rail turns cyan, chip/port shown.
2. Bring-up: Flash tab → latest build → `Erase + flash` → progress → auto-reconnect → Install espOS → `Reboot`.
3. Iterate: Editor → change `apps/foo/app.py` → `Save + soft reset` → REPL shows output, device redraws.

## UX rules

- Every device action shows live state (connecting / working with progress / done / error with the raw error text) — never a silent spinner.
- Destructive actions (erase flash, delete file, overwrite existing espOS files) confirm inline, in warning amber.
- WebSerial unsupported (Safari/Firefox/mobile) → explicit banner naming the browsers that work, plus the `esptool`/`mpremote` CLI fallback commands.

## Firmware guide

`/guide`: Russian long-form setup guide, sticky desktop contents, copyable commands, pin table; single-column mobile with locally scrollable code blocks. Linked from the Studio sidebar.

## Wiring schematic
Technical SVG connection diagram, net colours with labels and junction dots; logical signal mapping, not physical pin locations. Shared SPI drawn as branches. Locally scrolls on mobile. Unverified hardware and power/backlight limitations displayed alongside.

## Multi-chip Flasher
Family selector plus explicit ROM detection button (resets device, no flash writes), immutable firmware selection while busy. Detected family separate from manual target; mismatch blocks writes. Expose family-specific bootloader offset and variant caveats. No promise of espOS portability outside S3.

## Diagnostics and recovery
Keep the instrument-panel design. A flat recovery block is always available, including offline: probable cause, raw error, last confirmed stage, and numbered BOOT/RST/USB instructions. Reconnecting never triggers ROM commands or reflashing. Flash-write failures explicitly warn that contents may be partial. Export a bounded timestamped session with frozen target/image/USB/browser metadata; do not include REPL contents automatically. No cancellation button during erase/write.

## Wi-Fi LAN milestone
New Wi-Fi tab: USB first-time provisioning, password-masked LAN pairing token, explicit status check, app directory browser/editor with inline overwrite/reboot confirmations. USB controls remain separate. PC-hosted Studio bridges to one explicitly configured private IPv4 device, disabled by default; phone uses the same Studio via LAN. No arbitrary URL proxy, cloud relay, BLE, full REPL, MicroPython OTA or core-file edits in this milestone. Credentials stay in component memory / device-only network_config.py, never logs or localStorage. Device requests use one-use expiring challenges and HMAC; local HTTP content is not encrypted, trusted isolated LAN only. Preserve existing palette, typography and responsive panels.

## Wi-Fi v2 security iteration
USB establishes/rotates the shared pairing secret; signed status proves possession before UI enables app operations. Challenge binds fresh client randomness; domain-separated HMAC keys sign challenge, request and exact response payload with nonce/request hash/HTTP status. No v1 downgrade. Any unverified response clears pairing evidence and blocks mutations until a new status check. Explicit USB LAN-disable action revokes service access after reset, separate from forgetting browser session. HTTP confidentiality limitation stays visible; no BLE/TLS scope expansion.

## Beginner USB start — approved
Mode selection on landing: Simple start vs Advanced tools; preserve all advanced tabs, no stored mode or secrets. Simple start uses wide readable single-column steps with a progress rail and human-language explanations, same dark/cyan typography. S3 DevKitC only, external modules disconnected; ROM family proof mandatory, memory selected by verified module specification (unknown blocks), latest stable matching standard/SPIRAM_OCT build selected automatically. Address 0 and baud 115200 fixed. Separate erase and app overwrite confirmations, no automatic retry or auto-install after flash. Headless install disables display/touch and writes LAN-disabled config explicitly; fresh boot evidence checked separately from copied files and MicroPython response. Mode/back/parameter controls disabled during operations, reconnect clears device evidence, recovery journal retained. Wi-Fi/display setup later; hardware validation pending.
