"""espOS window manager: scans /apps, draws the launcher grid, dispatches
touch events to the active app, and handles the home gesture.

Ctrl-C over USB raises KeyboardInterrupt (a BaseException, not caught below),
which drops you to the REPL — that's how espOS Studio / mpremote take over."""

import os
import sys
import time
import gc
from micropython import const
from espos import ui

TOP = const(20)       # status bar height + gap
COLS = const(3)
LABEL_H = const(14)
HOME_ZONE = const(24)  # tap a 24x24 box in the top-left corner to go home


def load_app_module(app_id):
    name = "apps.%s.app" % app_id
    if name in sys.modules:
        return sys.modules[name]
    __import__(name)
    return sys.modules[name]


def list_apps():
    out = []
    try:
        entries = os.listdir("/apps")
    except OSError:
        return out
    for name in sorted(entries):
        if name.startswith("_") or name.startswith("."):
            continue
        try:
            os.stat("/apps/%s/app.py" % name)
        except OSError:
            continue
        out.append(name)
    return out


class WindowManager:
    def __init__(self, display, touch):
        self.display = display
        self.touch = touch
        self.width = display.width
        self.height = display.height
        self.app_ids = []
        self.tiles = []
        self.active_app = None
        self.active_id = None
        self._was_pressed = False

    # ---------- discovery ----------
    def discover_apps(self):
        self.app_ids = list_apps()
        self.tiles = []
        tile_w = self.width // COLS
        icon = tile_w - 20
        for i, app_id in enumerate(self.app_ids):
            manifest = self._manifest(app_id)
            col, row = i % COLS, i // COLS
            self.tiles.append(
                ui.IconTile(
                    col * tile_w,
                    TOP + 6 + row * (icon + LABEL_H + 14),
                    tile_w,
                    icon,
                    manifest.get("name", app_id),
                    manifest.get("icon", app_id[:1].upper()),
                    manifest.get("color", ui.ACCENT),
                    app_id,
                )
            )

    def _manifest(self, app_id):
        try:
            return getattr(load_app_module(app_id), "MANIFEST", {})
        except Exception as e:
            print("espOS: cannot load app %s: %s" % (app_id, e))
            return {"name": app_id, "icon": "!", "color": ui.RED}

    # ---------- rendering ----------
    def draw_launcher(self):
        d = self.display
        d.clear(ui.BLACK)
        ui.status_bar(d, self.width, "espOS")
        if not self.tiles:
            d.draw_text8x8(8, 40, "No apps in /apps", ui.GRAY, ui.BLACK)
        for t in self.tiles:
            t.draw(d)

    # ---------- app lifecycle ----------
    def launch(self, app_id):
        gc.collect()
        try:
            mod = load_app_module(app_id)
            ctx = {"exit": self.go_home, "wm": self}
            self.active_app = mod.App(self.display, ctx)
            self.active_id = app_id
            self.active_app.on_start()
            ui.home_hint(self.display)
        except Exception as e:
            sys.print_exception(e)
            self.active_app = None
            self.show_error(app_id, e)

    def show_error(self, app_id, err):
        d = self.display
        d.clear(ui.BLACK)
        ui.status_bar(d, self.width, "Error: " + app_id)
        msg = str(err)
        y = 30
        while msg and y < self.height - 20:
            d.draw_text8x8(4, y, msg[:29], ui.RED, ui.BLACK)
            msg = msg[29:]
            y += 12
        d.draw_text8x8(4, self.height - 14, "tap to return", ui.GRAY, ui.BLACK)
        self.active_id = "__error__"

    def go_home(self):
        if self.active_app is not None:
            try:
                self.active_app.on_stop()
            except Exception as e:
                sys.print_exception(e)
        self.active_app = None
        self.active_id = None
        gc.collect()
        self.draw_launcher()

    # ---------- input ----------
    def poll_touch(self):
        if self.touch is None:
            return
        p = self.touch.read()
        pressed = p is not None
        if pressed and not self._was_pressed:
            self._on_tap(p[0], p[1])
        self._was_pressed = pressed

    def _on_tap(self, x, y):
        if self.active_id == "__error__":
            self.go_home()
            return
        if self.active_app is None:
            for t in self.tiles:
                if t.hit(x, y):
                    t.draw(self.display, pressed=True)
                    self.launch(t.app_id)
                    return
            return
        if x < HOME_ZONE and y < HOME_ZONE:
            self.go_home()
            return
        self.active_app.on_touch(x, y, True)

    # ---------- main loop ----------
    def tick(self):
        try:
            self.poll_touch()
            if self.active_app is not None:
                self.active_app.on_tick()
        except Exception as e:
            sys.print_exception(e)
            self.show_error(self.active_id or "wm", e)
            self.active_app = None

    def run(self):
        self.discover_apps()
        self.draw_launcher()
        while True:
            self.tick()
            time.sleep_ms(25)
