"""Headless entry point under CPython stubs: no TFT/touch SPI or LAN startup."""
import contextlib
import importlib.util
import io
import pathlib
import runpy
import sys
import types
import unittest

class HeadlessTests(unittest.TestCase):
    def boot(self, boot_levels=()):
        """Runs main.py headless. boot_levels: successive GPIO0 reads, then released (1)."""
        root=pathlib.Path(__file__).parents[1]/'firmware'
        config=types.ModuleType('config')
        exec((root/'config.py').read_text(),config.__dict__)
        config.DISPLAY_ENABLED=False;config.TOUCH_ENABLED=False
        calls=[];levels=list(boot_levels)
        class Pin:
            IN=0;PULL_UP=1
            def __init__(self,number,*args):calls.append(number)
            def value(self):return levels.pop(0) if levels else 1
        machine=types.ModuleType('machine');machine.Pin=Pin
        def SPI(*args,**kwargs):raise AssertionError('Headless must not start SPI')
        machine.SPI=SPI
        clock=types.ModuleType('time');clock.now=0;clock.sleeps=0
        clock.ticks_ms=lambda:clock.now
        clock.ticks_diff=lambda a,b:a-b
        def sleep_ms(ms):clock.now+=ms;clock.sleeps+=1
        clock.sleep_ms=sleep_ms
        settings=types.ModuleType('network_config');settings.ENABLED=False
        package=types.ModuleType('espos');package.__path__=[str(root/'lib/espos')]
        saved={name:sys.modules.get(name) for name in ['config','machine','network_config','espos','espos.hal','time']}
        try:
            sys.modules.update({'config':config,'machine':machine,'network_config':settings,'espos':package})
            sys.modules.pop('espos.hal',None)
            spec=importlib.util.spec_from_file_location('espos.hal',root/'lib/espos/hal.py')
            hal=importlib.util.module_from_spec(spec);spec.loader.exec_module(hal);package.hal=hal
            sys.modules['espos.hal']=hal
            output=io.StringIO()
            sys.modules['time']=clock  # main.py's MicroPython ticks/sleep_ms
            try:
                with contextlib.redirect_stdout(output):runpy.run_path(str(root/'main.py'))
            finally:
                sys.modules['time']=saved['time']
            return output.getvalue(),calls,hal,clock,config
        finally:
            for name,value in saved.items():
                if value is None:sys.modules.pop(name,None)
                else:sys.modules[name]=value

    def test_fresh_headless_boot_no_peripheral_gpio_or_radio(self):
        output,calls,hal,clock,config=self.boot()
        self.assertIn('espOS: ready / headless / USB',output)
        self.assertIn('hold BOOT now',output)
        self.assertNotIn('safe mode (BOOT',output)
        self.assertEqual(calls,[0])  # only BOOT safety input, no TFT/touch pins
        self.assertGreaterEqual(clock.now,config.SAFE_MODE_WINDOW_MS)  # full window waited
        self.assertIsNone(hal.get_touch())
        self.assertIsNone(hal._spi)

    def test_boot_pressed_after_reset_enters_safe_mode(self):
        # BOOT released at reset (ROM boots normally), pressed during the window.
        output,calls,hal,clock,config=self.boot([1,1,1,0,0])
        self.assertIn('safe mode (BOOT pressed after reset)',output)
        self.assertNotIn('ready / headless',output)
        self.assertLess(clock.now,config.SAFE_MODE_WINDOW_MS)  # returns as soon as debounced
        self.assertEqual(calls,[0])
        self.assertIsNone(hal._spi)

    def test_single_glitch_does_not_trigger_safe_mode(self):
        output,calls,hal,clock,config=self.boot([1,0,1,0,1])
        self.assertIn('espOS: ready / headless / USB',output)
        self.assertNotIn('safe mode (BOOT',output)

if __name__=='__main__':unittest.main()
