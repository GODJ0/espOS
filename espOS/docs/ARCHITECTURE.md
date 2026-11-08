# espOS architecture

## Layers

1. **MicroPython runtime** (stock, unmodified) — gives us the interpreter,
   filesystem, native USB-CDC REPL/file access, and later WiFi/BLE stacks for
   free. No custom firmware compile in the MVP.
2. **HAL** (`lib/espos/hal.py`) — wires up SPI/display/touch from `config.py`.
   Swapping display/touch chips or pinout only ever touches this file + config.
3. **Window manager** (`lib/espos/wm.py`) — discovers apps under `/apps`,
   draws the launcher grid, routes touch events, owns the "one active app at
   a time" model with a universal back gesture (tap top-left corner).
4. **App framework** (`lib/espos/app.py`, `ui.py`) — every app is a folder
   with an `app.py` exposing `MANIFEST` + `class App(BaseApp)`. No LVGL/C
   deps — plain `framebuf`-based drawing calls for MVP speed; can be swapped
   for `lv_micropython`/LVGL later without changing the app contract much.
5. **Apps** — `settings`, `about` today; `wifi`, `ble`, `files`, `terminal`,
   `app-store` planned.

## Why MicroPython instead of ESP-IDF/C or a custom interpreter

- User needs code changeable without recompiling → rules out plain .bin/C.
- MicroPython ships an official ESP32-S3 build with native USB-CDC already
  working (REPL + raw-paste file transfer) → USB flashing/dev loop is free.
- WiFi/BLE Python APIs are already in the firmware → OTA and BLE transport
  (phase 2/3) are additions on top, not new firmware builds.
- Precedent: M5Stack UIFlow and the community "MicroPythonOS" project both
  use this exact approach for a launcher-style OS on ESP32.

## Companion transport model

| Transport | Phase | How |
|---|---|---|
| USB | MVP | Native USB-CDC; espOS Studio uses WebSerial in-browser, or `mpremote`/`esptool` from a terminal |
| BLE | 2 | Custom GATT service: file-chunk write characteristic + command channel |
| WiFi | 3 | Device runs a small HTTP server (upload endpoint + REPL-over-websocket, à la MicroPython's WebREPL) |

## Security notes (relevant given the user's background)

- USB REPL has full filesystem + `exec()` access by design (same as stock
  MicroPython) — anyone with physical USB access owns the device. Treat it
  like a debug port, not a trust boundary.
- BLE/WiFi phases must add auth (pairing code / token) before they ship —
  do not expose raw REPL/file-write over a wireless transport unauthenticated.
- Firmware has no secure boot / flash encryption in the MVP. Worth enabling
  via `idf.py` for any build meant for real-world/field deployment rather
  than dev boards on a bench.
