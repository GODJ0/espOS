"""Touch calibration math, kept free of hardware imports so it runs under
CPython tests too.

Calibration lives in the panel's native portrait space (TFT_WIDTH x
TFT_HEIGHT), the same space hal.SharedTouch.read() normalizes into before
rotating to screen space. The calibration targets are drawn inset from the
edges, so the raw range is extrapolated from them to the true screen edges."""

RAW_MAX = 4095  # XPT2046 is a 12-bit ADC


def to_native(sx, sy, rotation, width, height):
    """Screen point -> native portrait point (inverse of SharedTouch.read)."""
    if rotation == 90:
        return width - sy, sx
    if rotation == 180:
        return width - sx, height - sy
    if rotation == 270:
        return sy, height - sx
    return sx, sy


def _fit(points):
    """Least-squares line raw = a * pos + b over (pos, raw) pairs."""
    n = len(points)
    sp = sum(p for p, _ in points)
    sr = sum(r for _, r in points)
    spp = sum(p * p for p, _ in points)
    spr = sum(p * r for p, r in points)
    den = n * spp - sp * sp
    if den == 0:
        raise ValueError("Calibration targets must differ")
    a = (n * spr - sp * sr) / den
    return a, (sr - a * sp) / n


def _axis(name, points, size, min_span):
    a, b = _fit(points)
    at_zero, at_size = b, a * size + b
    lo = max(0, int(round(min(at_zero, at_size))))
    hi = min(RAW_MAX, int(round(max(at_zero, at_size))))
    if hi - lo < min_span:
        raise ValueError("Raw %s barely follows screen %s: check wiring or swapped axes" % (name, name))
    return lo, hi, at_size < at_zero


def solve(native_points, raws, width, height, min_span=200):
    """native_points: target positions in native portrait space; raws: the
    averaged raw (x, y) measured at each. Returns config values that map the
    screen edges (not the inset targets) to 0..width / 0..height."""
    if len(native_points) != len(raws) or len(raws) < 2:
        raise ValueError("Need matching target and raw samples")
    x_min, x_max, inv_x = _axis("X", [(p[0], r[0]) for p, r in zip(native_points, raws)], width, min_span)
    y_min, y_max, inv_y = _axis("Y", [(p[1], r[1]) for p, r in zip(native_points, raws)], height, min_span)
    return {
        "TOUCH_X_MIN": x_min,
        "TOUCH_X_MAX": x_max,
        "TOUCH_Y_MIN": y_min,
        "TOUCH_Y_MAX": y_max,
        "TOUCH_INVERT_X": inv_x,
        "TOUCH_INVERT_Y": inv_y,
    }


def config_lines(result):
    return ["%s = %s" % (k, result[k]) for k in
            ("TOUCH_X_MIN", "TOUCH_X_MAX", "TOUCH_Y_MIN", "TOUCH_Y_MAX", "TOUCH_INVERT_X", "TOUCH_INVERT_Y")]
