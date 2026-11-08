"""Shared display/touch SPI bus guard under CPython stubs."""
import importlib.util
import pathlib
import sys
import types
import unittest


def load_hal():
    root = pathlib.Path(__file__).parents[1] / 'firmware'
    config = types.ModuleType('config')
    exec((root / 'config.py').read_text(), config.__dict__)
    machine = types.ModuleType('machine')
    machine.Pin = type('Pin', (), {'IN': 0, 'OUT': 1, 'PULL_UP': 2,
                                   '__init__': lambda self, *a, **k: None,
                                   'value': lambda self, *a: 1})
    machine.SPI = type('SPI', (), {})
    package = types.ModuleType('espos')
    package.__path__ = [str(root / 'lib/espos')]
    saved = {n: sys.modules.get(n) for n in ['config', 'machine', 'espos', 'espos.hal']}
    sys.modules.update({'config': config, 'machine': machine, 'espos': package})
    sys.modules.pop('espos.hal', None)
    spec = importlib.util.spec_from_file_location('espos.hal', root / 'lib/espos/hal.py')
    hal = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hal)
    return hal, saved


class FakeSPI:
    def __init__(self):
        self.writes = []
        self.inits = []
        self.deinited = False
        self.on_write = None

    def write(self, data):
        if self.on_write:
            self.on_write()
        self.writes.append(data)

    def init(self, **kw):
        self.inits.append(kw)

    def deinit(self):
        self.deinited = True


class SpiGuardTests(unittest.TestCase):
    def setUp(self):
        self.hal, self.saved = load_hal()

    def tearDown(self):
        for name, value in self.saved.items():
            if value is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = value

    def test_display_write_passes_through_and_releases_guard(self):
        raw = FakeSPI()
        spi = self.hal._GuardedSPI(raw)
        spi.write(b'\x2a')
        spi.write(b'\x2b')
        self.assertEqual(raw.writes, [b'\x2a', b'\x2b'])
        self.assertFalse(self.hal._spi_busy)
        spi.deinit()
        self.assertTrue(raw.deinited)
        self.assertFalse(self.hal._spi_busy)

    def test_display_write_during_touch_read_is_rejected(self):
        spi = self.hal._GuardedSPI(FakeSPI())
        with self.hal._SPI_GUARD:  # touch read in flight
            with self.assertRaisesRegex(RuntimeError, 'concurrent SPI'):
                spi.write(b'\x00')
        self.assertFalse(self.hal._spi_busy)

    def test_touch_read_during_display_write_is_rejected_and_bus_recovers(self):
        raw = FakeSPI()
        spi = self.hal._GuardedSPI(raw)
        touch = self.hal.SharedTouch.__new__(self.hal.SharedTouch)
        touch.irq = None
        touch.spi = FakeSPI()
        raw.on_write = lambda: touch.raw()  # touch fires mid display transfer
        with self.assertRaisesRegex(RuntimeError, 'concurrent SPI'):
            spi.write(b'\x00')
        self.assertEqual(touch.spi.inits, [])  # clock never touched
        self.assertFalse(self.hal._spi_busy)  # guard released after failure
        raw.on_write = None
        spi.write(b'\x01')  # bus usable again
        self.assertEqual(raw.writes, [b'\x01'])

    def test_touch_restores_tft_clock_and_releases_guard_on_error(self):
        touch = self.hal.SharedTouch.__new__(self.hal.SharedTouch)
        touch.irq = None
        touch.spi = FakeSPI()

        class Boom:
            def raw_touch(self):
                raise OSError('spi fault')
        touch.drv = Boom()
        with self.assertRaises(OSError):
            touch.raw()
        self.assertEqual(touch.spi.inits[-1]['baudrate'], self.hal.cfg.SPI_BAUDRATE)
        self.assertFalse(self.hal._spi_busy)

    def display(self, spi):
        # Load the actual bundled driver, not a mock of its CS handling.
        saved = {n: sys.modules.get(n) for n in ['framebuf', 'micropython']}
        fb = types.ModuleType('framebuf'); fb.FrameBuffer = object; fb.RGB565 = 1
        mp = types.ModuleType('micropython'); mp.const = lambda value: value
        try:
            sys.modules.update({'framebuf': fb, 'micropython': mp})
            source = pathlib.Path(__file__).parents[1] / 'firmware/lib/drivers/ili9341.py'
            spec = importlib.util.spec_from_file_location('test_ili9341', source)
            driver = importlib.util.module_from_spec(spec); spec.loader.exec_module(driver)
        finally:
            for name, value in saved.items():
                if value is None: sys.modules.pop(name, None)
                else: sys.modules[name] = value
        display = driver.Display.__new__(driver.Display)
        display.spi = spi
        display.levels = []
        display.cs = lambda value: display.levels.append(('cs', value))
        display.dc = lambda value: display.levels.append(('dc', value))
        display.write_data = display.write_data_mpy
        return display

    def test_actual_driver_rejects_before_cs_or_dc_changes(self):
        raw = FakeSPI(); display = self.display(self.hal._GuardedSPI(raw))
        with self.hal._SPI_GUARD:
            for action in [lambda: display.write_cmd_mpy(0x2a), lambda: display.write_data_mpy(b'\x01')]:
                with self.assertRaisesRegex(RuntimeError, 'concurrent SPI'): action()
            self.assertTrue(self.hal._spi_busy)
        self.assertEqual(display.levels, [])
        self.assertEqual(raw.writes, [])
        display.write_cmd_mpy(0x2a, 1, 2)
        self.assertEqual(raw.writes, [b'\x2a', b'\x01\x02'])
        self.assertEqual(display.levels, [('dc', 0), ('cs', 0), ('cs', 1), ('dc', 1), ('cs', 0), ('cs', 1)])

    def test_actual_driver_write_failure_releases_cs_guarded_and_raw(self):
        for guarded in [False, True]:
            for is_command in [False, True]:
                raw = FakeSPI()
                def fail(): raise OSError('write failed')
                raw.on_write = fail
                display = self.display(self.hal._GuardedSPI(raw) if guarded else raw)
                with self.assertRaisesRegex(OSError, 'write failed'):
                    if is_command: display.write_cmd_mpy(0x2a)
                    else: display.write_data_mpy(b'\x00')
                self.assertEqual(display.levels[-1], ('cs', 1))
                self.assertFalse(self.hal._spi_busy)
                raw.on_write = None
                display.write_data_mpy(b'\x01')
                self.assertEqual(raw.writes, [b'\x01'])

    def test_reentrant_touch_during_actual_display_transaction_releases_cs(self):
        raw = FakeSPI(); display = self.display(self.hal._GuardedSPI(raw))
        touch = self.hal.SharedTouch.__new__(self.hal.SharedTouch)
        touch.irq = None; touch.spi = FakeSPI()
        raw.on_write = lambda: touch.raw()
        with self.assertRaisesRegex(RuntimeError, 'concurrent SPI'): display.write_data_mpy(b'\x00')
        self.assertEqual(display.levels[-1], ('cs', 1))
        self.assertEqual(touch.spi.inits, [])
        self.assertFalse(self.hal._spi_busy)

    def test_slow_clock_init_failure_attempts_restore(self):
        class FailSlow(FakeSPI):
            def init(self, **kw):
                super().init(**kw)
                if len(self.inits) == 1: raise OSError('slow failed')
        touch = self.hal.SharedTouch.__new__(self.hal.SharedTouch)
        touch.irq = None; touch.spi = FailSlow()
        with self.assertRaisesRegex(OSError, 'slow failed'): touch.raw()
        self.assertEqual([v['baudrate'] for v in touch.spi.inits], [self.hal.cfg.TOUCH_SPI_BAUDRATE, self.hal.cfg.SPI_BAUDRATE])
        self.assertFalse(self.hal._spi_busy)

    def test_restore_failure_is_not_reported_as_success_and_releases_guard(self):
        class FailBoth(FakeSPI):
            def init(self, **kw):
                super().init(**kw)
                raise OSError('clock failed')
        touch = self.hal.SharedTouch.__new__(self.hal.SharedTouch)
        touch.irq = None; touch.spi = FailBoth()
        with self.assertRaisesRegex(OSError, 'clock failed'): touch.raw()
        self.assertEqual(len(touch.spi.inits), 2)
        self.assertFalse(self.hal._spi_busy)


if __name__ == '__main__':
    unittest.main()
