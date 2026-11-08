"""Minimal widget helpers on top of the ILI9341 driver (no LVGL dependency).
Keeps the MVP dependency-free and fast to flash/iterate on."""


def rgb(r, g, b):
    """24-bit RGB -> RGB565."""
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)


BLACK = 0x0000
WHITE = 0xFFFF
GRAY = rgb(138, 147, 162)
DARK_GRAY = rgb(20, 23, 29)
PANEL = rgb(14, 16, 20)
BORDER = rgb(30, 35, 44)
BLUE = rgb(59, 130, 246)
GREEN = rgb(74, 222, 128)
RED = rgb(244, 100, 106)
YELLOW = rgb(251, 191, 36)
ORANGE = rgb(249, 115, 22)
PURPLE = rgb(167, 139, 250)
ACCENT = rgb(34, 211, 238)  # espOS cyan


def text_center(display, cx, y, text, color, bg=BLACK):
    display.draw_text8x8(max(0, cx - len(text) * 4), y, text, color, bg)


class Button:
    """Rectangular touch target. hit(x, y) -> bool."""

    def __init__(self, x, y, w, h, label, on_press=None, color=ACCENT, text_color=BLACK):
        self.x, self.y, self.w, self.h = x, y, w, h
        self.label = label
        self.on_press = on_press
        self.color = color
        self.text_color = text_color

    def hit(self, x, y):
        return self.x <= x < self.x + self.w and self.y <= y < self.y + self.h

    def draw(self, display, pressed=False):
        fill = WHITE if pressed else self.color
        display.fill_rectangle(self.x, self.y, self.w, self.h, fill)
        text_center(display, self.x + self.w // 2, self.y + (self.h - 8) // 2, self.label, self.text_color, fill)


class IconTile:
    """One tile in the launcher's app grid: square icon + label below."""

    def __init__(self, x, y, w, icon, name, letter, color, app_id):
        self.x, self.y, self.w = x, y, w
        self.icon = icon
        self.name = name
        self.letter = (letter or "?")[:2]
        self.color = color
        self.app_id = app_id

    def hit(self, x, y):
        return self.x <= x < self.x + self.w and self.y <= y < self.y + self.icon + 16

    def draw(self, display, pressed=False):
        ix = self.x + (self.w - self.icon) // 2
        c = WHITE if pressed else self.color
        display.fill_rectangle(ix, self.y, self.icon, self.icon, c)
        # tiny corner notch = espOS signature
        display.fill_rectangle(ix + self.icon - 8, self.y, 8, 8, BLACK)
        cx = ix + self.icon // 2
        cy = self.y + self.icon // 2 - 4
        text_center(display, cx, cy, self.letter, BLACK, c)
        text_center(display, self.x + self.w // 2, self.y + self.icon + 5, self.name[: self.w // 8], WHITE, BLACK)


def status_bar(display, width, title, right=None):
    display.fill_rectangle(0, 0, width, 16, DARK_GRAY)
    display.fill_rectangle(0, 16, width, 1, ACCENT)
    display.draw_text8x8(28, 4, title[: (width - 40) // 8], WHITE, DARK_GRAY)
    if right:
        display.draw_text8x8(width - 8 * len(right) - 4, 4, right, GRAY, DARK_GRAY)


def home_hint(display):
    """Draws the home glyph in the top-left corner (the home tap zone)."""
    display.fill_rectangle(4, 4, 16, 9, DARK_GRAY)
    display.draw_text8x8(4, 4, "<", ACCENT, DARK_GRAY)
    display.draw_text8x8(10, 4, "-", ACCENT, DARK_GRAY)
