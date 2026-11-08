"""Hardware abstraction: wires up SPI, the ILI9341 display and XPT2046 touch
using the pins in config.py. Import get_display()/get_touch() from apps.

Notes for the shared bus:
- ILI9341 is happy at 40 MHz, XPT2046 tops out around 2 MHz. The touch
  wrapper drops the bus clock for each touch read and restores it after.
- The vendor driver's get_touch() blocks up to 2 s when nothing is pressed.
  SharedTouch.read() is non-blocking: it checks T_IRQ (low while pressed)
  and takes a handful of samples only when there is actually a touch.
"""

from machine import Pin, SPI
import time
import config as cfg

_spi = None
_display = None
_touch = None
_spi_busy = False


class _SpiGuard:
    """Re-entrancy guard for the shared display/touch SPI bus (see
    SharedTouch docstring). One pre-built instance (_SPI_GUARD) is reused.
    This is a diagnostic invariant for synchronous/cooperative callers,
    not an atomic thread lock or an IRQ-safe primitive. Never access SPI
    from hard IRQs or other threads; schedule work on the main loop. Raises
    instead of silently interleaving two SPI users at mismatched clock
    speeds."""

    def __enter__(self):
        global _spi_busy
        if _spi_busy:
            raise RuntimeError(
                "espOS: concurrent SPI access detected (display/touch bus "
                "is not re-entrant) - serialize callers or add a real lock"
            )
        _spi_busy = True

    def __exit__(self, *exc):
        global _spi_busy
        _spi_busy = False


_SPI_GUARD = _SpiGuard()


class _GuardedSPI:
    """SPI wrapper handed to the display driver. Every transfer the display
    makes takes the bus guard, so a display write that overlaps a touch read
    (which holds the guard for its whole slow-clock window) raises instead of
    corrupting the transfer. The ILI9341 driver uses transfer() to guard
    DC/CS and the bytes as one transaction. Touch uses the raw SPI object
    directly and holds the guard for its entire clock-change window."""

    def __init__(self, spi):
        self._spi = spi

    def write(self, data):
        with _SPI_GUARD:
            self._spi.write(data)

    def transfer(self, dc, cs, is_data, data):
        # Acquire before touching either control pin. A rejected nested
        # transfer must not deselect another caller's active peripheral.
        with _SPI_GUARD:
            try:
                dc(is_data)
                cs(0)
                self._spi.write(data)
            finally:
                cs(1)

    def deinit(self):
        with _SPI_GUARD:
            self._spi.deinit()


def _cfg(name, default):
    return getattr(cfg, name, default)


def get_spi():
    global _spi
    if _spi is None:
        _spi = SPI(
            cfg.SPI_ID,
            baudrate=cfg.SPI_BAUDRATE,
            sck=Pin(cfg.TFT_SCLK),
            mosi=Pin(cfg.TFT_MOSI),
            miso=Pin(cfg.TFT_MISO),
        )
    return _spi


def screen_size():
    if cfg.TFT_ROTATION in (90, 270):
        return cfg.TFT_HEIGHT, cfg.TFT_WIDTH
    return cfg.TFT_WIDTH, cfg.TFT_HEIGHT


def get_display():
    """Returns the Display, or None when DISPLAY_ENABLED is False or init fails
    (espOS then runs headless and stays fully usable over USB REPL)."""
    global _display
    if _display is not None:
        return _display
    if not _cfg("DISPLAY_ENABLED", True):
        return None
    try:
        from drivers.ili9341 import Display

        w, h = screen_size()
        _display = Display(
            _GuardedSPI(get_spi()),
            cs=Pin(cfg.TFT_CS, Pin.OUT),
            dc=Pin(cfg.TFT_DC, Pin.OUT),
            rst=Pin(cfg.TFT_RST, Pin.OUT),
            width=w,
            height=h,
            rotation=cfg.TFT_ROTATION,
            bgr=cfg.TFT_BGR,
        )
        if cfg.TFT_BL is not None:
            Pin(cfg.TFT_BL, Pin.OUT).value(1)
    except Exception as e:
        print("espOS: display init failed, running headless:", e)
        _display = None
    return _display


class SharedTouch:
    """Non-blocking XPT2046 reader that coexists with the display on one SPI bus.

    Bus-speed safety: `raw()` drops the shared SPI clock to
    TOUCH_SPI_BAUDRATE for the duration of the touch read, then restores
    TFT speed in a `finally`. This is only race-free because nothing else
    is allowed to issue SPI transfers while a touch read is in flight.
    That currently holds because:
      - the window manager calls `poll_touch()` synchronously inside
        `tick()`, with no `await` between `_slow()` and `_fast()`;
      - MicroPython's asyncio is single-threaded and cooperative, so no
        other task can run SPI code in that window; and
      - the LAN service (net_service.py) never touches SPI/display.
    `_SPI_GUARD` makes that invariant loud instead of silent: if a
    future transport (BLE GATT writes, a second async task, an
    scheduled callback) ever calls into the display or touch driver
    re-entrantly, this raises immediately instead of corrupting a
    transfer or wedging the bus at the wrong clock speed. The display
    side is covered too: get_display() gives the ILI9341 driver a
    _GuardedSPI, so DC/CS and each byte transfer take the same guard.
    This boolean guard cannot serialize threads or hard IRQs. All hardware
    access must stay on the cooperative main loop; future async clients
    may need a task-level lock/queue around complete operations.
    """

    def __init__(self, spi, cs_pin, irq_pin):
        from drivers.xpt2046 import Touch

        self.spi = spi
        self.irq = Pin(irq_pin, Pin.IN, Pin.PULL_UP) if irq_pin is not None else None
        # Raw driver: calibration lives here, we only use raw_touch()/normalize().
        self.drv = Touch(
            spi,
            cs=Pin(cs_pin, Pin.OUT),
            width=cfg.TFT_WIDTH,
            height=cfg.TFT_HEIGHT,
            x_min=cfg.TOUCH_X_MIN,
            x_max=cfg.TOUCH_X_MAX,
            y_min=cfg.TOUCH_Y_MIN,
            y_max=cfg.TOUCH_Y_MAX,
        )
        self.screen_w, self.screen_h = screen_size()
        self.invert_x = _cfg("TOUCH_INVERT_X", False)
        self.invert_y = _cfg("TOUCH_INVERT_Y", False)

    def _slow(self):
        self.spi.init(baudrate=_cfg("TOUCH_SPI_BAUDRATE", 1_000_000))

    def _fast(self):
        self.spi.init(baudrate=cfg.SPI_BAUDRATE)

    def _sample_unfiltered(self):
        # The driver's raw_touch() drops readings outside the configured
        # min/max - calibration must see the full 12-bit range it is about
        # to measure. Without T_IRQ, Z1 pressure decides "pressed".
        d = self.drv
        if self.irq is None and d.send_command(d.GET_Z1) < _cfg("TOUCH_Z_MIN", 100):
            return None
        x = d.send_command(d.GET_X)
        y = d.send_command(d.GET_Y)
        if 0 < x < 4095 and 0 < y < 4095:
            return x, y
        return None

    def raw(self, samples=5, unfiltered=False):
        """Averaged raw ADC (x, y) or None. unfiltered=True ignores the
        configured calibration range (used by the calibration app)."""
        if self.irq is not None and self.irq.value() == 1:
            return None
        with _SPI_GUARD:
            try:
                self._slow()
                xs, ys = 0, 0
                got = 0
                for _ in range(samples):
                    s = self._sample_unfiltered() if unfiltered else self.drv.raw_touch()
                    if s is None:
                        continue
                    xs += s[0]
                    ys += s[1]
                    got += 1
                    time.sleep_ms(2)
            finally:
                self._fast()
        if got < max(2, samples // 2):
            return None
        return xs // got, ys // got

    def read(self):
        """Screen-space (x, y) of the current touch, or None. Never blocks long."""
        r = self.raw()
        if r is None:
            return None
        # Normalize in the panel's native portrait space ...
        x, y = self.drv.normalize(r[0], r[1])
        if self.invert_x:
            x = cfg.TFT_WIDTH - x
        if self.invert_y:
            y = cfg.TFT_HEIGHT - y
        # ... then rotate into screen space to match the display rotation.
        rot = cfg.TFT_ROTATION
        if rot == 90:
            x, y = y, cfg.TFT_WIDTH - x
        elif rot == 180:
            x, y = cfg.TFT_WIDTH - x, cfg.TFT_HEIGHT - y
        elif rot == 270:
            x, y = cfg.TFT_HEIGHT - y, x
        x = min(max(x, 0), self.screen_w - 1)
        y = min(max(y, 0), self.screen_h - 1)
        return x, y

    def apply_calibration(self, c):
        """Uses touch_calib.solve() values for this session (until reboot),
        so the calibration app's draw test checks them before config.py."""
        d = self.drv
        d.x_min, d.x_max = c["TOUCH_X_MIN"], c["TOUCH_X_MAX"]
        d.y_min, d.y_max = c["TOUCH_Y_MIN"], c["TOUCH_Y_MAX"]
        d.x_multiplier = d.width / (d.x_max - d.x_min)
        d.x_add = d.x_min * -d.x_multiplier
        d.y_multiplier = d.height / (d.y_max - d.y_min)
        d.y_add = d.y_min * -d.y_multiplier
        self.invert_x = c["TOUCH_INVERT_X"]
        self.invert_y = c["TOUCH_INVERT_Y"]

    # Kept for compatibility with code written against the vendor driver.
    def get_touch(self):
        return self.read()


def get_touch():
    """Returns SharedTouch, or None if touch is disabled / not wired."""
    global _touch
    if _touch is not None:
        return _touch
    if not _cfg("TOUCH_ENABLED", True) or get_display() is None:
        return None
    try:
        _touch = SharedTouch(get_spi(), cfg.TOUCH_CS, cfg.TOUCH_IRQ)
    except Exception as e:
        print("espOS: touch init failed:", e)
        _touch = None
    return _touch
