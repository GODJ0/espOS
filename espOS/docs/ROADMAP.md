# espOS roadmap

## Phase 1 — MVP (this drop)
- [x] MicroPython + custom `espos` package: HAL, window manager, app framework
- [x] ILI9341 240x320 + XPT2046 touch drivers wired in
- [x] Launcher grid + apps: hello, touch (calibration), sysmon, settings, about
- [x] Safe mode (BOOT pressed within 1.5 s after reset) and headless fallback
- [x] USB flashing/dev workflow (esptool + mpremote) documented
- [x] espOS Studio: web app, WebSerial flash + file sync + REPL terminal

## Phase 2 — BLE transport
- [ ] Custom GATT service (file transfer + command exec) on the device
- [ ] Pairing/auth (no unauthenticated code exec over BLE)
- [ ] espOS Studio: WebBluetooth support; mobile app BLE support

## Phase 3 — WiFi transport
- [x] Opt-in LAN HTTP service: signed status/list/read/update existing app files/reboot (software-tested; S3 radio pending)
- [x] PC-hosted Studio LAN bridge and responsive Wi-Fi tab for desktop/Android/iPhone browsers (mock-tested)
- [ ] Real S3 radio, flash filesystem rename, display/touch responsiveness and phone LAN testing
- [ ] Firmware OTA with rollback/recovery strategy; not part of current app-file updates
- [ ] WebREPL-style terminal over WebSocket
- [x] Pairing token + expiring one-use HMAC challenges, opt-in fixed-IP/origin bridge, app-only paths
- [x] Wi-Fi v2 signed fresh-client challenge, request-bound response/error envelopes, separate HMAC keys, USB-only rotation/revoke and no v1 downgrade (software-tested)
- [ ] TLS and access without a PC; current HTTP requires trusted isolated LAN; signatures are not encryption

## Phase 4 — Mobile companion app
- [ ] Expo app: connect via BLE/WiFi, browse/install apps, device REPL

## Phase 5 — App store / distribution
- [ ] App manifest schema + signing
- [ ] Hosted catalog, in-launcher "install" flow

## Phase 6 — Portability beyond ESP32-S3
- [x] Studio Web Flasher: manual selection / ROM family probe for ESP32, S2, S3, C2, C3, C6; family guards and full-image offsets (software-tested only)
- [ ] Real-board flashing and boot verification for each supported flasher family
- [ ] Board-config abstraction for ESP32 / C3 / C6 / etc.
- [ ] Per-board pin/capability profiles, no-display headless mode

Web Flasher support is not an espOS firmware port. Current espOS HAL and wiring remain S3 DevKitC-specific; hardware validation is pending.
