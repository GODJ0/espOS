from espos.app import BaseApp
from espos import ui
import machine
import os

MANIFEST = {"name": "Settings", "icon": "S", "color": ui.ORANGE}


class App(BaseApp):
    def on_start(self):
        d = self.display
        w = d.width
        d.clear(ui.BLACK)
        ui.status_bar(d, w, "Settings")
        self.reboot_btn = ui.Button(16, 40, w - 32, 36, "Reboot", color=ui.RED)
        self.soft_btn = ui.Button(16, 86, w - 32, 36, "Reload launcher", color=ui.ACCENT)
        self.reboot_btn.draw(d)
        self.soft_btn.draw(d)
        s = os.statvfs("/")
        free_kb = s[0] * s[3] // 1024
        total_kb = s[0] * s[2] // 1024
        info = [
            "CPU   %d MHz" % (machine.freq() // 1_000_000),
            "Flash %d / %d KB free" % (free_kb, total_kb),
            "UID   " + "".join("%02x" % b for b in machine.unique_id()),
        ]
        for i, line in enumerate(info):
            d.draw_text8x8(16, 140 + i * 14, line, ui.GRAY, ui.BLACK)

    def on_touch(self, x, y, pressed):
        d = self.display
        if self.reboot_btn.hit(x, y):
            self.reboot_btn.draw(d, pressed=True)
            machine.reset()
        elif self.soft_btn.hit(x, y):
            self.soft_btn.draw(d, pressed=True)
            wm = self.ctx["wm"]
            wm.discover_apps()
            self.ctx["exit"]()
