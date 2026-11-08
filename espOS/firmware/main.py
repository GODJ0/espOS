"""espOS entry point. Flashed once, then left alone — all app logic lives
under /apps and can be updated over USB (mpremote / espOS Studio) without
touching this file.

Recovery: if an app or config change makes boot misbehave, press and release
RST, then press and hold BOOT (GPIO0) while the console shows "hold BOOT now".
main.py polls it for SAFE_MODE_WINDOW_MS and skips straight to the REPL so you
can fix files over USB. Do not hold BOOT *while* pressing RST: GPIO0 is a
strapping pin, so the chip would start its ROM bootloader and main.py would
never run."""

import config
import time
from machine import Pin


def safe_mode_requested():
    """Polls BOOT for a short window after reset. Two consecutive low reads
    (debounce) request safe mode. SAFE_MODE_WINDOW_MS = 0 disables it."""
    window = getattr(config, "SAFE_MODE_WINDOW_MS", 1500)
    if window <= 0:
        return False
    try:
        boot = Pin(0, Pin.IN, Pin.PULL_UP)
        print("espOS: hold BOOT now for safe mode (%d ms)" % window)
        start = time.ticks_ms()
        low = 0
        while time.ticks_diff(time.ticks_ms(), start) < window:
            low = low + 1 if boot.value() == 0 else 0
            if low >= 2:
                return True
            time.sleep_ms(25)
    except Exception:
        pass
    return False


def main():
    print("espOS %s on %s" % (config.FIRMWARE_VERSION, config.DEVICE_NAME))
    if safe_mode_requested():
        print("espOS: safe mode (BOOT pressed after reset) — launcher skipped, REPL is free")
        return

    from espos import hal

    display = hal.get_display()
    try:
        import network_config as settings
        network_enabled = getattr(settings, "ENABLED", False)
    except ImportError:
        network_enabled = False
    if network_enabled:
        import asyncio

        async def run_connected():
            server = None
            try:
                from espos.net_service import start
                server = await start()
            except Exception as e:
                print("espOS: LAN disabled after error:", e)
            try:
                if display is None:
                    if server is None:
                        print("espOS: LAN unavailable; returning to USB REPL")
                        return
                    print("espOS: headless LAN; Ctrl-C returns to USB REPL")
                    while True:
                        await asyncio.sleep_ms(100)
                else:
                    from espos.wm import WindowManager
                    wm = WindowManager(display, hal.get_touch())
                    wm.discover_apps()
                    wm.draw_launcher()
                    while True:
                        wm.tick()
                        await asyncio.sleep_ms(25)
            finally:
                if server is not None:
                    server.close()
                    await server.wait_closed()

        asyncio.run(run_connected())
    elif display is None:
        print("espOS: headless mode — use the USB REPL / espOS Studio")
        print("espOS: ready / headless / USB")
    else:
        from espos.wm import WindowManager
        wm = WindowManager(display, hal.get_touch())
        wm.run()


main()
