"""Base class every espOS app subclasses. Put an app in /apps/<name>/app.py
with a module-level MANIFEST dict and a class App(BaseApp)."""


class BaseApp:
    def __init__(self, display, ctx):
        self.display = display
        self.ctx = ctx  # dict: {"exit": callable, "toast": callable, ...}

    def on_start(self):
        """Called once when the app becomes active. Draw your first frame here."""
        pass

    def on_touch(self, x, y, pressed):
        """Called on every touch event. x/y in screen coordinates, pressed=True/False."""
        pass

    def on_tick(self):
        """Called repeatedly in the main loop (~20-30x/sec). Keep it fast/non-blocking."""
        pass

    def on_stop(self):
        """Called when the app is closed / user goes back to the launcher."""
        pass


# Manifest template for reference — copy into each app's app.py:
# MANIFEST = {"name": "My App", "icon": "A", "color": 0x07E0}
