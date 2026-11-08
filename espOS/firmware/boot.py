"""Runs on every power-on/reset, before main.py. Keep this minimal and robust —
an exception here can make the board hard to recover without a full erase."""

import gc
import sys

sys.path.append("/lib")
sys.path.append("/")

gc.collect()
