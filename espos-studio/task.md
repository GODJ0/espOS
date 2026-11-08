# Multi-chip Web Flasher
- Scope: ESP32, S2, S3, C2, C3, C6. Hardware unverified.
- Official offsets checked: classic ESP32/S2 0x1000, S3/C2/C3/C6 0x0.
- Add shared chip profiles, parameterised firmware API, ROM probe, safe image/family validation and manual selection.
- Auto detection reads ROM; does not erase or write flash, but resets the board.
- Do not imply espOS pinout/framework portability. Installation remains S3 profile only.
- Fix port ownership: close serial after releasing streams before esptool opens it; report reconnect failures.
- Verify profile/API/safety tests, browser UI, lint/build. Deliver updated app and source zip.

## Verification
- 7 guard/transport mock tests passed, 31 assertions.
- All six official stable v1.29.0 binaries fetched; image header IDs match profiles.
- All six firmware API queries returned appropriate families/offsets.
- Browser: all six manual families render their builds/offsets; auto mode waits for ROM probe; disconnected and connected mobile layout checked, header clipping fixed.
- Simulated USB browser test: C3 image against S3 rejected before transport, zero serial writes; no page runtime errors. Guide still renders.
- Bun guard tests, TypeScript, lint and build passed. Self-hosting notes/roadmap updated; final checks repeated after responsive header fix.
- Source archive regenerated for delivery, dependencies/secrets/build outputs excluded.
- Real hardware still untested. Next: S3 UART/USB ROM connection, flash, MicroPython boot, espOS display/touch lifecycle. No advertisements launched.

## Diagnostics / recovery iteration
- Approved: error classification, stage evidence, bounded timestamped export with immutable session snapshot; recovery checklist and manual USB reconnect; transport cleanup/disconnect safety tests.
- API/database unchanged. Keep current design. Never automatically erase/write/retry; no unsafe timeout/cancellation during write.
- Implemented: classified recovery block, USB manual picker, stage events and local bounded journal with frozen target/image metadata; partial-write warning and completed-write-vs-boot distinction.
- Serial detects hardware disconnect/stream errors, rejects absent-port reopen, releases picker lock after cancellation. Flasher constructor and cleanup paths release ownership even on errors.
- Verified: 14 flasher/diagnostics tests (67 assertions), 3 serial tests in separate process (8 assertions); browser wrong-image guard, frozen export, USB disconnect, cancelled picker, manual reconnect with zero serial writes, mobile overflow; TypeScript/lint passed.
- Final build passed; updated source archive prepared and CRC/exclusions checked for delivery. Hardware verification still pending; no advertising spend.

## Wi-Fi first, BLE later — approved
- S3 first; PC-hosted local Studio accessible from Android/iPhone browser over trusted LAN. Android explicitly part of Wi-Fi milestone; BLE compatibility later.
- Implement opt-in device service + USB provisioning; HMAC one-use challenges; status/list/read/write app files and explicit reboot. No remote exec/full REPL/OTA or core config editing.
- Bridge opt-in env, fixed allowlisted private IP/device port and exact browser origins. Token in request/component memory only. No accounts/database; server does not discover/scan LAN.
- Tests: protocol auth/replay/path/revision/limits; bridge gate/IP/origin/response bounds; mocks for firmware HTTP and browser API. Hardware/WLAN radio not yet verified.
- Implemented device protocol + bounded HTTP parser + asyncio launcher integration; USB provisioning writes private network_config.py excluded from generated payload. Existing USB-only flow preserved.
- Bridge opt-in private IPv4 / fixed port / exact Origin, HMAC challenges, timeouts/bounded responses, no retry; Wi-Fi app editor and confirmations with token only in session memory. Local dev binds LAN interface; public preview remains disabled.
- Verified 7 Python protocol/HTTP integration tests; 5 LAN Bun tests; total 22 Bun tests including USB regression, 105 assertions. TypeScript/lint/build passed, Python compiled and payload regenerated. Desktop/default bridge + mobile mocked status/list/read/write/confirmation checked; USB recovery browser regression passed.
- docs/WIFI.md + SELF_HOSTING.md explain Android/iPhone via PC, unencrypted HTTP/trusted LAN limits, no BLE/OTA/full REPL. Real S3 Wi-Fi/radio/filesystem/display coexistence and actual Android tests pending.
- Updated full-source archive prepared for delivery; excludes device network_config.py and all environment secrets. Next milestone after hardware feedback: BLE transport and stronger LAN security / response authentication.

## Wi-Fi v2 approved, resumed
- Keep Wi-Fi. Add signed fresh-client challenge + signed response/error envelopes bound to request hash, nonce and status; separate derived HMAC keys. Reject v1, no retries.
- USB-only shared-secret pairing/rotation and explicit disable/revoke action. Signed status gates UI app operations; reset evidence after token changes/errors.
- Implemented signed v2 envelopes and fresh-client challenge, separate keys, request nonce/hash/status binding and signed post-parse errors; pre-parse/busy unsigned results rejected. UI gates apps on signed status; token/error/reboot/forget clears evidence. Explicit USB provisioning/rotation/revoke; no v1 fallback and no retries.
- Verified 8 Python protocol + actual HTTP-parser tests, Python compilation; generated payload updated (23 files). 20 LAN Bun tests including actual Python-to-Node UTF-8 signing interoperability; USB regression 14 flasher/diagnostics + 3 serial tests (37 Bun tests total).
- Browser USB recovery passed; saved tests/wifi-browser.py passes phone/desktop UI mocks: pairing gate, explicit write, evidence reset, no retry, no overflow/runtime errors. USB revoke hardware execution is unverified.
- TypeScript, lint and build passed; build has existing large-chunk and Node deprecation warnings. WIFI.md, SELF_HOSTING.md, ROADMAP.md updated. Real S3 Wi-Fi, display/touch/flash concurrency, rotation/revoke and actual Android remain pending. No advertising spend.
- Final archive regenerated and CRC/exclusions/v2 source checked for delivery.

## Beginner Simple start — implemented
- Approved: landing mode selector, current style, USB-only S3 DevKitC without display; all advanced tools retained. No Wi-Fi wizard, accounts, database or new API.
- ROM S3 guard; unknown memory blocks flashing; latest stable standard/SPIRAM_OCT selected by explicitly verified module type, fixed 0x0/115200. Separate erase/install confirmations, no auto retries, mode/back/parameters locked during work. Existing MicroPython can skip flashing after explicit response check.
- Installer validates headless profile, writes LAN-disabled config first, writes bundle/package markers, reads profile back; separate fresh reset/espOS ready evidence. First USB arithmetic test touches no GPIO/files. Disconnect invalidates MicroPython/install/boot evidence; recovery export stays available.
- Official S3 MicroPython page checked: flash >=4 MiB, standard supports no/Quad PSRAM, Octal requires SPIRAM_OCT. Family-only detection does not prove board/memory compatibility; unknown remains blocked.
- Verified 6 beginner Bun tests (31 assertions), 34 flasher/diagnostics/LAN + 3 separate serial tests (43 total). Actual headless main/HAL CPython stub test verifies no SPI/peripheral GPIO initialization, only BOOT safety input. All 9 Python tests and firmware compilation passed; bundle regenerated.
- Browser beginner transport mocks pass mode choice, wrong chip, busy controls, unknown memory/Octal, confirmed erase and overwrite, partial failures/no retry, LAN-off/headless profile, fresh boot, demo, disconnect and 390px layout. USB recovery and Wi-Fi browser regressions passed after adapting mode selection. Screenshots inspected.
- TypeScript, lint and final build passed (existing large-chunk/Node deprecation warnings). SELF_HOSTING updated. Archive regenerated/CRC/secrets exclusions checked for delivery.
- Real S3 ROM/flash/PSRAM, USB reset and headless boot remain unverified; no promise of automatic memory detection or production readiness. Next: user hardware test of Simple start, then guided peripheral/network setup.

## User archive merge / SPI transaction fixes
- Merged user archive dated 2026-10-13: HAL guard, SPI regression tests, GPIO safety comment and HMAC explanation. Retained current Studio, beginner/advanced modes, USB recovery, Wi-Fi v2 and latest OG asset/metadata.
- Display adapter acquires guard before DC/CS changes and releases CS in finally; actual ILI9341 driver uses the adapter transaction, with a finally-protected raw machine.SPI fallback. Rejected nested calls do not touch another caller's control pins.
- Touch slow-clock init is inside try/finally, so fast-clock restoration is attempted even when slow init fails. Restore failure propagates and releases the guard; faulty hardware clock recovery is not guaranteed.
- Boolean guard is a synchronous/cooperative reentrancy diagnostic, not an atomic thread/IRQ lock. Keep hardware access on the main loop; future callers need operation-level serialization as appropriate.
- Verified 18 Python tests (including 9 SPI tests with bundled ILI9341 driver and CPython stubs), firmware compilation and regenerated payload. Verified 43 Bun tests in isolated groups, TypeScript, lint and build. Existing large-chunk/Node deprecation warnings remain.
- All three browser regressions passed: beginner, USB recovery and Wi-Fi v2, using mocked transport. Real S3 USB/flash/PSRAM, display/touch, Wi-Fi and Android remain unverified. No automatic erase/write/retry added; hardware-first plan unchanged.

## User hardware feedback / archive checkpoint
- User evidence now confirms basic S3 headless boot and USB arithmetic; Octal variant selected after ordinary build emitted PSRAM init errors. Two boards/USB bridges and browsers were used, so auto-ROM root cause is not isolated.
- USB network provisioning and real WLAN association/IP obtained. Signed status still fails; direct Windows TCP/ARP unreachable for board and another Wi-Fi client with VPN off. Router lists board online. Ethernet test unavailable; isolation/PC filters remain hypotheses.
- HARDWARE_STATUS.md records evidence boundaries, Windows setup/token workaround, remaining tests and proposed but NOT implemented UI/ROM fixes. Current checkpoint changes documentation only; firmware/UI logic unchanged.

## Review fixes: safe mode, touch calibration, raw REPL, Windows (espOS 0.1.1-mvp)
- Safe mode: GPIO0 is a strapping pin, so BOOT held during RST enters the ROM bootloader and main.py never runs. main.py now announces `hold BOOT now` and polls BOOT for SAFE_MODE_WINDOW_MS (1.5 s, debounced); README, About, guide and ROADMAP describe RST first, then BOOT.
- Touch calibration: the launcher-tap finger no longer becomes point 1; calibration reads bypass the configured raw range (Z1 pressure without T_IRQ); inset targets are extrapolated to the screen edges per native axis with rotation and mirror detection (touch_calib.py), applied for the session so the draw test checks them before config.py.
- Raw REPL: every operation re-handshakes (Ctrl-A also resets a raw REPL), so a board reset behind Studio's back (RST on USB-UART keeps the port) never receives code in the friendly REPL; a boot banner mid-operation aborts it; unknown state after errors makes soft reset leave raw REPL first. writeFile writes `.espos-tmp`, re-reads it from flash, compares SHA-256, then renames.
- Windows: gen_payload uses fileURLToPath (no `C:\C:\`, Cyrillic paths work); net_protocol replace_file uses os.replace on CPython; kill:port uses Get-NetTCPConnection/taskkill on Windows. Bun Shell already handles `$(...)` and `2>/dev/null`.
- Verified on Windows: 32 Python tests (new safe mode, calibration math, unfiltered XPT2046 driver reads, app tap flow; rename tests now pass), 48 Bun tests (new raw-REPL board simulator: 4 of 5 fail on the old mpy.ts), TypeScript, build, konsistent and oxlint run by hand (`runkit lint` cannot spawn .js tools on Windows). Payload regenerated (24 files). Hardware still unverified: safe-mode timing, real panel calibration and USB writes need an S3 test.

## v4 review / fail-closed file replacement
- Isolated review of the v4 archive (CRC, paths, sizes) before merge. Re-ran here on Linux: 32 Python tests, firmware compilation, 48 Bun tests in isolated groups, TypeScript, lint, build, payload (24 files) — all passed. The Windows results in the previous entry are the archive author's report.
- Found: both USB `writeFile()` and firmware `replace_file()` caught any rename OSError, deleted the original, and renamed again; if the second rename failed, temp cleanup deleted the verified copy too (simulated with forced rename errors on Linux: both copies lost). Existing fakes always renamed successfully, so tests did not exercise it.
- Fixed: no remove-then-rename fallback anywhere. USB: rename failure raises DeviceError naming the kept `<path>.espos-tmp`; verified temp is never removed; os.sync error after rename reported separately. Firmware: temp re-read and compared before replace; `os.replace` (CPython) or `os.rename`; failure raises ReplaceError (not OSError, so HTTP returns the message rather than 404) and keeps the verified temp; unverified temp still cleaned up. Fail-closed handling, not power-loss atomicity; FAT is still not supported for overwrite.
- Regressions: Bun FAT-like FakeBoard (rename refuses an existing target) — original and verified temp kept, no os.remove sent; Python FAT-like os wrapper without os.replace — same. Totals: 49 Bun, 33 Python. Payload regenerated (24 files). HARDWARE_STATUS/NEXT_STEPS updated for implemented safe mode/calibration/USB writes.
- Real S3 flash rename, safe-mode timing, panel calibration and LAN reachability remain unverified.
