from espos.app import BaseApp
from espos import ui
import config
import sys

MANIFEST = {"name": "About", "icon": "i", "color": ui.BLUE}


class App(BaseApp):
    def on_start(self):
        d = self.display
        d.clear(ui.BLACK)
        ui.status_bar(d, d.width, "About")
        lines = [
            ("espOS " + config.FIRMWARE_VERSION, ui.ACCENT),
            ("", 0),
            ("MicroPython " + sys.version.split(";")[0], ui.WHITE),
            ("Board  ESP32-S3", ui.WHITE),
            ("Screen %dx%d" % (d.width, d.height), ui.WHITE),
            ("Touch  XPT2046", ui.WHITE),
            ("", 0),
            ("USB REPL is always on.", ui.GRAY),
            ("Ctrl-C stops the launcher.", ui.GRAY),
            ("Safe mode: press RST,", ui.GRAY),
            ("then hold BOOT 1.5 s.", ui.GRAY),
        ]
        for i, (line, color) in enumerate(lines):
            if line:
                d.draw_text8x8(10, 30 + i * 13, line, color, ui.BLACK)
