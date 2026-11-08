"""Touch calibration: extrapolation math, unfiltered raw reads through the
actual XPT2046 driver, and the calibration app's tap handling (CPython stubs)."""
import importlib.util
import pathlib
import sys
import types
import unittest

ROOT = pathlib.Path(__file__).parents[1] / 'firmware'
W, H = 240, 320


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


calib = load('touch_calib_under_test', ROOT / 'lib/espos/touch_calib.py')


def panel(nx, ny, invert_x=False):
    """Synthetic panel: raw X 300..3800 across native width, raw Y 250..3700."""
    fx = (W - nx) / W if invert_x else nx / W
    return int(round(300 + 3500 * fx)), int(round(250 + 3450 * ny / H))


TARGETS = [(20, 40), (220, 40), (220, 300), (20, 300)]  # what the app draws in portrait


class CalibrationMathTests(unittest.TestCase):
    def test_inset_targets_are_extrapolated_to_screen_edges(self):
        raws = [panel(x, y) for x, y in TARGETS]
        r = calib.solve(TARGETS, raws, W, H)
        self.assertAlmostEqual(r['TOUCH_X_MIN'], 300, delta=2)
        self.assertAlmostEqual(r['TOUCH_X_MAX'], 3800, delta=2)
        self.assertAlmostEqual(r['TOUCH_Y_MIN'], 250, delta=2)
        self.assertAlmostEqual(r['TOUCH_Y_MAX'], 3700, delta=2)
        self.assertFalse(r['TOUCH_INVERT_X'] or r['TOUCH_INVERT_Y'])
        # The old min/max of the inset samples would shrink the range noticeably.
        self.assertGreater(min(x for x, _ in raws) - r['TOUCH_X_MIN'], 250)

    def test_mirrored_axis_sets_invert_and_keeps_min_below_max(self):
        r = calib.solve(TARGETS, [panel(x, y, invert_x=True) for x, y in TARGETS], W, H)
        self.assertTrue(r['TOUCH_INVERT_X'])
        self.assertLess(r['TOUCH_X_MIN'], r['TOUCH_X_MAX'])
        self.assertAlmostEqual(r['TOUCH_X_MIN'], 300, delta=2)

    def test_rotation_maps_screen_targets_back_to_native_space(self):
        for rot in (0, 90, 180, 270):
            sw, sh = (H, W) if rot in (90, 270) else (W, H)
            screen = [(20, 40), (sw - 20, 40), (sw - 20, sh - 20), (20, sh - 20)]
            native = [calib.to_native(x, y, rot, W, H) for x, y in screen]
            r = calib.solve(native, [panel(x, y) for x, y in native], W, H)
            self.assertAlmostEqual(r['TOUCH_X_MIN'], 300, delta=2, msg=rot)
            self.assertAlmostEqual(r['TOUCH_Y_MAX'], 3700, delta=2, msg=rot)
            self.assertFalse(r['TOUCH_INVERT_X'] or r['TOUCH_INVERT_Y'], rot)

    def test_axis_that_does_not_move_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'swapped axes'):
            calib.solve(TARGETS, [(2000, panel(x, y)[1]) for x, y in TARGETS], W, H)


class Pin:
    IN = 0; OUT = 1; PULL_UP = 2
    level = 0  # T_IRQ low = pressed

    def __init__(self, number, *a, **k):
        self.number = number

    def init(self, *a, **k):
        pass

    def value(self, *a):
        return Pin.level

    def __call__(self, *a):
        pass


class AdcSPI:
    """XPT2046 over SPI: returns the 12-bit value programmed per command byte."""
    def __init__(self, values):
        self.values = values
        self.inits = []

    def init(self, **kw):
        self.inits.append(kw)

    def write_readinto(self, tx, rx):
        v = self.values.get(tx[0], 0)
        rx[1] = (v >> 4) & 0xFF
        rx[2] = (v & 0xF) << 4


class SharedTouchTests(unittest.TestCase):
    def setUp(self):
        config = types.ModuleType('config')
        exec((ROOT / 'config.py').read_text(), config.__dict__)
        machine = types.ModuleType('machine'); machine.Pin = Pin; machine.SPI = object
        mp = types.ModuleType('micropython'); mp.const = lambda v: v
        package = types.ModuleType('espos'); package.__path__ = [str(ROOT / 'lib/espos')]
        drivers = types.ModuleType('drivers'); drivers.__path__ = [str(ROOT / 'lib/drivers')]
        names = ['config', 'machine', 'micropython', 'espos', 'espos.hal', 'drivers', 'drivers.xpt2046']
        self.saved = {n: sys.modules.get(n) for n in names}
        sys.modules.update({'config': config, 'machine': machine, 'micropython': mp, 'espos': package, 'drivers': drivers})
        for n in ('espos.hal', 'drivers.xpt2046'):
            sys.modules.pop(n, None)
        self.hal = load('espos.hal', ROOT / 'lib/espos/hal.py')
        self.hal.time = types.SimpleNamespace(sleep_ms=lambda ms: None)
        self.cfg = config
        Pin.level = 0

    def tearDown(self):
        for name, value in self.saved.items():
            if value is None: sys.modules.pop(name, None)
            else: sys.modules[name] = value

    def touch(self, x, y, z1=800, irq=None):
        spi = AdcSPI({0b11010000: x, 0b10010000: y, 0b10110000: z1})
        return self.hal.SharedTouch(spi, self.cfg.TOUCH_CS, irq), spi

    def test_unfiltered_raw_sees_values_outside_configured_range(self):
        t, _ = self.touch(3900, 3600)  # beyond the default TOUCH_X_MAX/Y_MAX
        self.assertIsNone(t.raw())  # vendor filter drops it
        self.assertEqual(t.raw(unfiltered=True), (3900, 3600))
        self.assertFalse(self.hal._spi_busy)

    def test_unfiltered_without_irq_uses_pressure(self):
        t, _ = self.touch(1000, 1000, z1=5)
        self.assertIsNone(t.raw(unfiltered=True))
        t, _ = self.touch(1000, 1000, z1=500)
        self.assertEqual(t.raw(unfiltered=True), (1000, 1000))

    def test_unfiltered_with_irq_released_reads_nothing(self):
        t, spi = self.touch(1000, 1000, irq=16)
        Pin.level = 1
        self.assertIsNone(t.raw(unfiltered=True))
        self.assertEqual(spi.inits, [])

    def test_applied_calibration_maps_targets_back_to_screen(self):
        raws = [panel(x, y) for x, y in TARGETS]
        r = calib.solve(TARGETS, raws, W, H)
        for (sx, sy), (rx, ry) in zip(TARGETS + [(120, 160)], raws + [panel(120, 160)]):
            t, _ = self.touch(rx, ry)
            t.apply_calibration(r)
            x, y = t.read()
            self.assertAlmostEqual(x, sx, delta=2)
            self.assertAlmostEqual(y, sy, delta=2)

    def test_applied_inverted_calibration(self):
        raws = [panel(x, y, invert_x=True) for x, y in TARGETS]
        r = calib.solve(TARGETS, raws, W, H)
        t, _ = self.touch(*raws[0])
        t.apply_calibration(r)
        x, y = t.read()
        self.assertAlmostEqual(x, TARGETS[0][0], delta=2)


class FakeDisplay:
    width, height = W, H

    def __getattr__(self, name):
        return lambda *a, **k: None


class FakeTouch:
    def __init__(self):
        self.value = None
        self.applied = None

    def raw(self, samples=5, unfiltered=False):
        assert unfiltered, 'calibration must bypass the configured range'
        return self.value

    def read(self):
        return None

    def apply_calibration(self, c):
        self.applied = c


class CalibrationAppTests(unittest.TestCase):
    def setUp(self):
        config = types.ModuleType('config')
        exec((ROOT / 'config.py').read_text(), config.__dict__)
        config.TFT_ROTATION = 0
        mp = types.ModuleType('micropython'); mp.const = lambda v: v
        package = types.ModuleType('espos'); package.__path__ = [str(ROOT / 'lib/espos')]
        self.fake = FakeTouch()
        hal = types.ModuleType('espos.hal'); hal.get_touch = lambda: self.fake
        names = ['config', 'micropython', 'espos', 'espos.hal', 'espos.app', 'espos.ui', 'espos.touch_calib']
        self.saved = {n: sys.modules.get(n) for n in names}
        for n in names[4:]:
            sys.modules.pop(n, None)
        sys.modules.update({'config': config, 'micropython': mp, 'espos': package, 'espos.hal': hal})
        package.hal = hal
        self.app = load('touch_app_under_test', ROOT / 'apps/touch/app.py').App(FakeDisplay(), {})

    def tearDown(self):
        for name, value in self.saved.items():
            if value is None: sys.modules.pop(name, None)
            else: sys.modules[name] = value

    def tap(self, value):
        self.fake.value = value; self.app.on_tick()
        self.fake.value = None; self.app.on_tick()

    def test_finger_from_launcher_tap_is_not_recorded(self):
        self.fake.value = (3000, 3000)  # still pressed after tapping the tile
        self.app.on_start()
        for _ in range(5):
            self.app.on_tick()
        self.assertEqual(self.app.raw_pts, [])
        self.fake.value = None; self.app.on_tick()
        self.tap(panel(*TARGETS[0]))
        self.assertEqual(self.app.raw_pts, [panel(*TARGETS[0])])

    def test_four_taps_apply_extrapolated_calibration(self):
        self.app.on_start()
        self.app.on_tick()
        for target in self.app.targets:
            self.tap(panel(*target))
        self.assertEqual(self.app.step, 4)
        self.assertAlmostEqual(self.fake.applied['TOUCH_X_MIN'], 300, delta=2)
        self.assertAlmostEqual(self.fake.applied['TOUCH_Y_MAX'], 3700, delta=2)
        self.tap((100, 100))
        self.assertEqual(self.app.step, 5)  # draw test

    def test_failed_calibration_restarts_on_tap(self):
        self.app.on_start()
        self.app.on_tick()
        for target in self.app.targets:
            self.tap((2000, panel(*target)[1]))  # X never changes
        self.assertIsNone(self.fake.applied)
        self.tap((100, 100))
        self.assertEqual((self.app.step, self.app.raw_pts), (0, []))


if __name__ == '__main__':
    unittest.main()
