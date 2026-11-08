"""Template app — copy this folder to start a new one."""

from espos.app import BaseApp
from espos import ui

MANIFEST = {"name": "Hello", "icon": "H", "color": ui.GREEN}


class App(BaseApp):
    def on_start(self):
        d = self.display
        d.clear(ui.BLACK)
        ui.status_bar(d, d.width, "Hello")
        ui.text_center(d, d.width // 2, 60, "Hello from espOS!", ui.WHITE)
        ui.text_center(d, d.width // 2, 80, "Edit /apps/hello/app.py", ui.GRAY)
        self.btn = ui.Button(40, 120, d.width - 80, 40, "Tap me", color=ui.GREEN)
        self.btn.draw(d)
        self.count = 0

    def on_touch(self, x, y, pressed):
        if self.btn.hit(x, y):
            self.count += 1
            d = self.display
            d.fill_rectangle(0, 180, d.width, 12, ui.BLACK)
            ui.text_center(d, d.width // 2, 180, "taps: %d" % self.count, ui.ACCENT)
            print("hello: tap", self.count)
