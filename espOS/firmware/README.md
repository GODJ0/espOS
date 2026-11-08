# espOS firmware (MVP — ESP32-S3, USB only)

Base: stock MicroPython for ESP32-S3 (official Espressif/MicroPython build — no
custom C compile needed for the MVP). espOS itself is a set of Python files
copied onto the device's filesystem on top of that.

## 1. Wiring (defaults — edit `config.py` if yours differs)

2.8" ILI9341 240x320 SPI TFT + XPT2046 touch, ESP32-S3 DevKitC:

| Display pin | ESP32-S3 GPIO | Touch pin | ESP32-S3 GPIO |
|---|---|---|---|
| SCLK | 12 | (shared SCLK) | 12 |
| MOSI | 11 | (shared MOSI) | 11 |
| MISO | 13 | (shared MISO) | 13 |
| CS   | 10 | T_CS | 15 |
| DC   | 9  | T_IRQ | 16 |
| RST  | 14 | | |
| BL_EN (optional logic input only) | 8, disabled by default | | |
| VCC | Per module datasheet; GPIO logic is 3.3V | | |
| GND | GND | | |

**Power warning:** do not drive a power LED pin from GPIO8. The default `TFT_BL = None` leaves backlight power to the module-specific circuit. Use GPIO8 only for a verified logic enable or external driver. This design assumes an XPT2046 resistive touch controller; verify the actual module. Connections are not yet tested on real hardware.

## 2. Flash stock MicroPython

Download the ESP32-S3 generic firmware from https://micropython.org/download/ESP32_GENERIC_S3/
(pick the build matching your board's flash size / whether it has SPIRAM/octal PSRAM).

```bash
pip install esptool mpremote
esptool.py --chip esp32s3 --port /dev/ttyACM0 erase_flash
esptool.py --chip esp32s3 --port /dev/ttyACM0 write_flash -z 0 ESP32_GENERIC_S3-*.bin
```

(On Windows the port looks like `COM5`; on macOS `/dev/cu.usbmodemXXXX`.)

## 3. Push espOS onto the device

```bash
cd firmware
mpremote connect /dev/ttyACM0 cp boot.py :boot.py
mpremote connect /dev/ttyACM0 cp main.py :main.py
mpremote connect /dev/ttyACM0 cp config.py :config.py
mpremote connect /dev/ttyACM0 mkdir :lib
mpremote connect /dev/ttyACM0 cp -r lib/ :lib/
mpremote connect /dev/ttyACM0 mkdir :apps
mpremote connect /dev/ttyACM0 cp -r apps/ :apps/
mpremote connect /dev/ttyACM0 reset
```

Or skip the CLI entirely and use **espOS Studio** (the companion web app) —
plug the board in, open it in Chrome/Edge, and it flashes + syncs files over
WebSerial with no local install.

## 4. Writing your own app

Create `apps/<yourapp>/app.py`:

```python
from espos.app import BaseApp
from espos import ui

MANIFEST = {"name": "Hello", "icon": "H", "color": ui.GREEN}

class App(BaseApp):
    def on_start(self):
        self.display.clear(ui.BLACK)
        self.display.draw_text8x8(20, 40, "Hello espOS!", ui.WHITE, ui.BLACK)

    def on_touch(self, x, y, pressed):
        pass
```

Push the folder with `mpremote cp -r apps/yourapp :apps/` (or via espOS Studio)
and it shows up as a tile on the launcher after reboot/reload — no recompiling
the firmware, ever.

## Bundled apps

| App | What it does |
|---|---|
| Hello | Template app — copy it to start your own |
| Touch | Touch calibration (tap 4 crosses → prints `TOUCH_*` values) + draw test |
| SysMon | Live heap / chip temperature / uptime + heap graph |
| Settings | Reboot, reload launcher, CPU / flash / UID info |
| About | Versions and recovery hints |

Navigation: tap a tile to open, tap the top-left corner (`<-`) to return.

## Touch calibration

Open **Touch** on the device, tap the 4 crosses, copy the printed
`TOUCH_X_MIN/MAX`, `TOUCH_Y_MIN/MAX` into `config.py`. If an axis is mirrored,
flip `TOUCH_INVERT_X` / `TOUCH_INVERT_Y`.

## Recovery / headless

- **Ctrl-C** over USB stops the launcher and gives you `>>>`.
- Press and release **RST**, then press and hold **BOOT** while the console
  shows `hold BOOT now` (1.5 s, `SAFE_MODE_WINDOW_MS`) → safe mode, launcher and
  LAN not started. Holding BOOT *during* RST enters the ROM bootloader instead
  (GPIO0 is a strapping pin) — that is the flashing mode, not safe mode.
- `DISPLAY_ENABLED = False` (or a failed display init) → headless mode; espOS
  is still fully usable over USB REPL / espOS Studio.

## Regenerating the Studio payload

After changing anything under `firmware/`, run `node tools/gen_payload.mjs` so
the one-click "Install espOS" in Studio ships the new files.
