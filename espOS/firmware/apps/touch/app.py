"""Touch calibration + test. Tap the 4 crosshairs; the app extrapolates the
raw ADC range to the screen edges, applies it for this session and prints the
config lines to the screen and the USB console — paste them into /config.py."""

from espos.app import BaseApp
from espos import ui, hal, touch_calib
import config

MANIFEST = {"name": "Touch", "icon": "+", "color": ui.PURPLE}

MARGIN = 20


class App(BaseApp):
    def on_start(self):
        self.touch = hal.get_touch()
        self.raw_pts = []
        self.result = None
        self.step = 0
        d = self.display
        w, h = d.width, d.height
        self.targets = [(MARGIN, MARGIN + 20), (w - MARGIN, MARGIN + 20), (w - MARGIN, h - MARGIN), (MARGIN, h - MARGIN)]
        # The finger that tapped the launcher tile is usually still down:
        # require a release before the first calibration point.
        self.was = True
        self._draw_step()

    def _cross(self, x, y, color):
        d = self.display
        d.draw_hline(x - 8, y, 17, color)
        d.draw_vline(x, y - 8, 17, color)

    def _draw_step(self):
        d = self.display
        d.clear(ui.BLACK)
        ui.status_bar(d, d.width, "Touch calibration")
        if self.step < 4:
            ui.text_center(d, d.width // 2, d.height // 2 - 10, "Tap the cross %d/4" % (self.step + 1), ui.WHITE)
            self._cross(*self.targets[self.step], ui.ACCENT)
        else:
            self._show_result()

    def _solve(self):
        rot = config.TFT_ROTATION
        native = [touch_calib.to_native(x, y, rot, config.TFT_WIDTH, config.TFT_HEIGHT) for x, y in self.targets]
        return touch_calib.solve(native, self.raw_pts, config.TFT_WIDTH, config.TFT_HEIGHT)

    def _show_result(self):
        d = self.display
        try:
            self.result = self._solve()
        except ValueError as e:
            self.result = None
            print("espOS touch calibration failed:", e)
            msg = str(e)
            lines = ["Calibration failed:"]
            while msg:
                lines.append(msg[:28])
                msg = msg[28:]
            lines += ["", "Tap anywhere to retry"]
        else:
            self.touch.apply_calibration(self.result)
            values = touch_calib.config_lines(self.result)
            lines = ["Raw samples:"] + ["  %d,%d" % p for p in self.raw_pts] + [""] + values + [
                "",
                "Applied until reboot.",
                "Paste into config.py",
                "(values printed to USB)",
                "",
                "Tap anywhere: draw test",
            ]
            print("espOS touch calibration (rotation %d):" % config.TFT_ROTATION)
            for line in values:
                print(line)
        for i, line in enumerate(lines):
            d.draw_text8x8(10, 26 + i * 12, line, ui.ACCENT if "=" in line else ui.WHITE, ui.BLACK)

    def on_tick(self):
        if self.touch is None:
            return
        if self.step == 5:
            p = self.touch.read()
            if p is not None:
                self.display.fill_rectangle(max(0, p[0] - 1), max(0, p[1] - 1), 3, 3, ui.ACCENT)
            return
        raw = self.touch.raw(unfiltered=True)
        pressed = raw is not None
        edge = pressed and not self.was
        self.was = pressed
        if not edge:
            return
        if self.step < 4:
            self.raw_pts.append(raw)
            self.step += 1
            self._draw_step()
        elif self.result is None:
            self.raw_pts = []
            self.step = 0
            self._draw_step()
        else:
            self.step = 5
            d = self.display
            d.clear(ui.BLACK)
            ui.status_bar(d, d.width, "Draw test")
            ui.home_hint(d)

    def on_touch(self, x, y, pressed):
        # input is handled in on_tick using raw values
        pass
