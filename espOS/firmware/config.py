# espOS board configuration
# Board: ESP32-S3 DevKitC + 2.8" SPI ILI9341 (240x320) with XPT2046 resistive touch
#
# Change these pin numbers to match your actual wiring. The display and touch
# controller share one SPI bus, each with its own CS line.
# Avoid GPIO 19/20 (native USB D-/D+), 26-32 (flash/PSRAM) and, on modules with
# Octal PSRAM (N8R8, N16R8), also 33-37. The default pins below (8-16) are all clear.

# --- Display (ILI9341) ---
DISPLAY_ENABLED = True   # False -> headless mode, espOS stays usable over USB REPL
TFT_SCLK = 12
TFT_MOSI = 11
TFT_MISO = 13
TFT_CS   = 10
TFT_DC   = 9
TFT_RST  = 14
TFT_BL   = None          # safe default: power LED per module datasheet, not from GPIO
# Use 8 only for a verified logic-level BL_EN or an external backlight driver.

# Native panel size (portrait). TFT_ROTATION 0/180 = portrait 240x320,
# 90/270 = landscape 320x240.
TFT_WIDTH  = 240
TFT_HEIGHT = 320
TFT_ROTATION = 0
TFT_BGR = True

# --- Touch (XPT2046), shares SCLK/MOSI/MISO with the display ---
TOUCH_ENABLED = True
TOUCH_CS  = 15
TOUCH_IRQ = 16           # T_IRQ, goes low while pressed; None to poll without it
TOUCH_SPI_BAUDRATE = 1_000_000

# Calibration: open the "Touch" app on the device, tap the corners, and paste
# the raw min/max it prints here. Flip INVERT_* if an axis is mirrored.
TOUCH_X_MIN = 100
TOUCH_X_MAX = 1962
TOUCH_Y_MIN = 100
TOUCH_Y_MAX = 1900
TOUCH_INVERT_X = False
TOUCH_INVERT_Y = False

# --- SPI bus ---
SPI_ID = 1
SPI_BAUDRATE = 40_000_000

# --- System ---
DEVICE_NAME = "espOS"
FIRMWARE_VERSION = "0.1.1-mvp"
# Safe mode: after RST, press and hold BOOT within this window (0 disables).
# Holding BOOT *during* RST enters the ROM bootloader instead.
SAFE_MODE_WINDOW_MS = 1500

# Legacy unused fields. LAN credentials now live in device-only /network_config.py,
# provisioned over USB through Studio. Missing network_config.py -> radio service off.
WIFI_SSID = ""
WIFI_PASSWORD = ""
