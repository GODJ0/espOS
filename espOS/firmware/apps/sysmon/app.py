"""Live system monitor: heap, chip temperature, uptime, with a heap graph."""

from espos.app import BaseApp
from espos import ui
import gc
import time

try:
    import esp32
except ImportError:
    esp32 = None

MANIFEST = {"name": "SysMon", "icon": "M", "color": ui.YELLOW}

GRAPH_H = 80


class App(BaseApp):
    def on_start(self):
        d = self.display
        d.clear(ui.BLACK)
        ui.status_bar(d, d.width, "System monitor")
        self.last = 0
        self.x = 0
        self.gy = d.height - GRAPH_H - 10
        d.draw_rectangle(0, self.gy - 1, d.width, GRAPH_H + 2, ui.BORDER)
        gc.collect()
        self.total = gc.mem_free() + gc.mem_alloc()

    def on_tick(self):
        now = time.ticks_ms()
        if time.ticks_diff(now, self.last) < 500:
            return
        self.last = now
        d = self.display
        free = gc.mem_free()
        used = gc.mem_alloc()
        temp = None
        if esp32 is not None and hasattr(esp32, "mcu_temperature"):
            try:
                temp = esp32.mcu_temperature()
            except Exception:
                temp = None
        up = now // 1000
        rows = [
            "Heap free %7d B" % free,
            "Heap used %7d B" % used,
            "Chip temp %s" % ("%d C" % temp if temp is not None else "n/a"),
            "Uptime    %02d:%02d:%02d" % (up // 3600, (up // 60) % 60, up % 60),
        ]
        for i, r in enumerate(rows):
            d.draw_text8x8(10, 32 + i * 16, r, ui.WHITE, ui.BLACK)
        # heap usage graph (scrolling column)
        h = int(GRAPH_H * used / max(1, self.total))
        d.fill_rectangle(self.x, self.gy, 2, GRAPH_H, ui.BLACK)
        d.fill_rectangle(self.x, self.gy + GRAPH_H - h, 2, h, ui.ACCENT)
        self.x = (self.x + 2) % d.width
        d.fill_rectangle(self.x, self.gy, 2, GRAPH_H, ui.BORDER)
