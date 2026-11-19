"""
fxgen: turn a settings dict into a Max for Live audio effect, using maxpylang.

The interactive plugin page (web/interactive-plugin.html) runs this file in the browser
under Pyodide. It works in two steps, and the split is the point:

    script(settings)  ->  the source of a plain maxpylang program
    run(settings)     ->  executes that program and returns the patch it built

So the Python the page shows is not a description of what happened, it is what ran. Copy
it into a file, `pip install maxpylang`, and it writes the same .amxd.

The module list, every dial's range and the presets' vocabulary live in schema.json next
to this file. The page reads the same file to draw its controls, so the two cannot drift.

Where maxpylang has no public way to say something a device needs, the emitted script
reaches into the box dict and says so in a comment that names the entry in
docs/type-system/m4l-gaps.md. Those workarounds are the gap log's evidence.
"""

import base64
import contextlib
import io
import json
import os
import re
import tempfile
import warnings

HERE = os.path.dirname(os.path.abspath(__file__))

SCHEMA = None


def load_schema(source=None):
    """Load schema.json. `source` is its text; without it the sibling file is read."""
    global SCHEMA
    if source is None:
        with open(os.path.join(HERE, "schema.json"), encoding="utf-8") as fh:
            source = fh.read()
    SCHEMA = json.loads(source)
    return SCHEMA


def schema():
    return SCHEMA if SCHEMA is not None else load_schema()


# ── settings ────────────────────────────────────────────────────────────────────

DEFAULT_NAME = "MaxPy FX"
NAME_OK = re.compile(r"[^A-Za-z0-9 _\-]")
HEX_OK = re.compile(r"^#[0-9a-fA-F]{6}$")


def _module(module_id):
    for m in schema()["modules"]:
        if m["id"] == module_id:
            return m
    return None


def _clamp_param(param, value):
    try:
        v = float(value)
    except (TypeError, ValueError):
        v = float(param["default"])
    if v != v:  # NaN
        v = float(param["default"])
    v = min(float(param["max"]), max(float(param["min"]), v))
    return float(round(v)) if param.get("integer") else v


def default_settings():
    return normalize({})


def normalize(settings):
    """
    Fill in and bound a settings dict, so everything after this can trust it.

    The page sends whatever is in its state, a shared link can carry anything, and the
    result is spliced into Python source, so nothing is passed through unchecked: unknown
    modules are dropped, a module listed twice is kept once, every value is clamped to its
    dial's range, and the name is reduced to characters that are safe in a file name.
    """
    sch = schema()
    settings = settings if isinstance(settings, dict) else {}

    name = NAME_OK.sub("", str(settings.get("name") or DEFAULT_NAME)).strip()[:32] or DEFAULT_NAME
    accent = settings.get("accent")
    if not (isinstance(accent, str) and HEX_OK.match(accent)):
        accent = sch["accents"][0]

    chain, seen = [], set()
    given = settings.get("chain")
    for entry in given if isinstance(given, list) else []:
        if not isinstance(entry, dict):
            continue
        mod = _module(entry.get("module"))
        if mod is None or mod["id"] in seen:
            continue
        seen.add(mod["id"])
        chain.append(_normalize_entry(mod, entry))
    for mod in sch["modules"]:
        if mod["id"] not in seen:
            chain.append(_normalize_entry(mod, {"on": False}))

    out_values = (settings.get("output") or {}) if isinstance(settings.get("output"), dict) else {}
    output = {p["id"]: _clamp_param(p, out_values.get(p["id"], p["default"])) for p in sch["output"]["params"]}

    return {"name": name, "accent": accent.lower(), "chain": chain, "output": output}


def _normalize_entry(mod, entry):
    options = entry.get("options") if isinstance(entry.get("options"), dict) else {}
    values = entry.get("values") if isinstance(entry.get("values"), dict) else {}
    opts = {}
    for opt in mod["options"]:
        ids = [c["id"] for c in opt["choices"]]
        opts[opt["id"]] = options.get(opt["id"]) if options.get(opt["id"]) in ids else opt["default"]
    vals = {p["id"]: _clamp_param(p, values.get(p["id"], p["default"])) for p in mod["params"]}
    return {"module": mod["id"], "on": bool(entry.get("on", True)), "options": opts, "values": vals}


def filename(settings):
    return normalize(settings)["name"].replace(" ", "_") + ".amxd"


# ── script emission ─────────────────────────────────────────────────────────────

# Patching-view geometry. Left and right channels run down two columns; each module's
# dials and control math sit in a third; presentation-only boxes are parked in a fourth.
X = {"L": 40, "R": 250}
SUB = 95          # a second object beside the first, inside one channel column
XC = 480          # control column
DX = 135          # between dials
XP = 860          # parked presentation boxes
ROW = 40
GAP = 50
DIAL_ROW = 62     # a live.dial is taller than an object box

# Presentation geometry. A Live device is 169 px tall; the width is ours to set.
DEVICE_H = 169
BRAND_W = 96
CARD_GAP = 6
CARD_PAD = 8
DIAL_W, DIAL_H = 44, 48
DIAL_STEP = 50
CARD_Y, CARD_H = 6, 157
TITLE_Y = 14
DIAL_Y = 72

UNITSTYLE = {"": "FLOAT", "x": "FLOAT", "Hz": "HERTZ", "ms": "MS", "%": "PERCENT", "dB": "DB", "bit": "INT"}

PREAMBLE = '''import maxpylang as mp

patch = mp.MaxPatch(verbose=False)

# Live's parameter_unitstyle values: how Ableton prints a dial's number.
INT, FLOAT, MS, HERTZ, DB, PERCENT = 0, 1, 2, 3, 4, 5


def place(text, x, y, fit=True):
    obj = patch.place(text, verbose=False)[0]
    if fit:
        # An object box as wide as its text, so nothing wraps when Max opens the patch.
        obj.edit(patching_rect=[float(x), float(y), max(40.0, 6.6 * len(text) + 12.0), 22.0])
    else:
        obj.move(float(x), float(y))
    return obj


def box(obj):
    # maxpylang has no public way to set the box keys used below, so this reaches into
    # the box dict. Each use names its entry in docs/type-system/m4l-gaps.md.
    return obj._dict["box"]


def show(obj, x, y, w, h):
    """Put a box in presentation mode, the view Ableton shows. (gap M4L-02)"""
    box(obj)["presentation"] = 1
    box(obj)["presentation_rect"] = [float(x), float(y), float(w), float(h)]


def dial(longname, shortname, at, slot, lo, hi, init, unit, exponent=1.0):
    """A live.dial: a knob Ableton can automate, map and save with the set."""
    d = place("live.dial", *at, fit=False)
    show(d, slot[0], slot[1], 44, 48)
    box(d)["varname"] = longname.lower().replace(" ", "_")
    box(d)["activedialcolor"] = ACCENT
    # The dial's range, unit and starting value. (gap M4L-01)
    box(d)["saved_attribute_attributes"] = {"valueof": {
        "parameter_longname": longname,
        "parameter_shortname": shortname,
        "parameter_type": 1 if unit == INT else 0,
        "parameter_mmin": float(lo),
        "parameter_mmax": float(hi),
        "parameter_initial_enable": 1,
        "parameter_initial": [float(init)],
        "parameter_unitstyle": unit,
        "parameter_exponent": float(exponent),
    }}
    return d


def label(text, at, slot, size=10.0, bold=False, color=None):
    """Text in the device view."""
    c = place("live.comment", *at, fit=False)
    box(c)["text"] = text  # (gap M4L-03)
    box(c)["fontsize"] = float(size)
    box(c)["fontface"] = 1 if bold else 0
    box(c)["textjustification"] = 1 if len(slot) == 4 else 0
    if color:
        box(c)["textcolor"] = color
    show(c, slot[0], slot[1], slot[2] if len(slot) > 2 else 90, 18)
    return c


def card(at, x, w, color):
    """A rounded panel behind one module's dials."""
    p = place("panel", *at, fit=False)
    p.edit(patching_rect=[float(at[0]), float(at[1]), 40.0, 20.0])
    box(p)["bgcolor"] = color
    box(p)["rounded"] = 8
    box(p)["background"] = 1  # (gap M4L-02)
    show(p, x, 6, w, 157)
    return p


def note(text, x, y):
    """A comment in the patching view."""
    c = place("comment", x, y, fit=False)
    c.edit(patching_rect=[float(x), float(y), 260.0, 20.0])
    box(c)["text"] = text  # after edit(), which rewrites the text key (gap M4L-03)
    return c
'''


def fnum(v):
    """A number as Max box text: floats always carry a decimal point (`0.5`, `1800.`)."""
    s = "%g" % round(float(v), 4)
    if "e" in s:
        s = ("%.6f" % float(v)).rstrip("0")
    return s if "." in s else s + "."


def pynum(v):
    return repr(round(float(v), 4))


def _rgba(hex_color, alpha=1.0):
    h = hex_color.lstrip("#")
    return [round(int(h[i:i + 2], 16) / 255.0, 3) for i in (0, 2, 4)] + [alpha]


class Script:
    """Collects the lines of the emitted program, one module section at a time."""

    def __init__(self):
        self.lines = []
        self.wires = []

    def emit(self, line=""):
        self.lines.append(line)

    def place(self, var, text, x, y):
        self.emit('%s = place("%s", %d, %d)' % (var, text, x, y))
        return var

    def wire(self, src, dst):
        self.wires.append((src, dst))

    def flush(self):
        """Write the section's cords as one connect() call."""
        if not self.wires:
            return
        self.emit("patch.connect(")
        for src, dst in self.wires:
            self.emit("    [%s, %s]," % (src, dst))
        self.emit("    verbose=False,")
        self.emit(")")
        self.wires = []

    def text(self):
        return "\n".join(self.lines) + "\n"


class Device:
    """The emitter's state while it walks the chain: where things go, in both views."""

    def __init__(self, settings):
        self.s = Script()
        self.settings = settings
        self.y = 30
        self.math_rows = 0
        self.card_x = BRAND_W + CARD_GAP
        self.park_y = 30

    # presentation -----------------------------------------------------------------

    def open_card(self, mod):
        """Reserve the next card in the device view; returns the x of its first dial."""
        n = len(mod["params"])
        w = CARD_PAD * 2 + n * DIAL_STEP - (DIAL_STEP - DIAL_W)
        w = max(w, 2 * CARD_PAD + 60)
        x = self.card_x
        self.s.emit("card((%d, %d), x=%d, w=%d, color=CARD)" % (XP, self.park_y, x, w))
        self.s.emit('label("%s", (%d, %d), (%d, %d, %d, 18), size=10.0, bold=True, color=ACCENT)'
                    % (mod["label"].upper(), XP + 60, self.park_y, x, TITLE_Y, w))
        self.park_y += 30
        self.card_x = x + w + CARD_GAP
        inner = n * DIAL_STEP - (DIAL_STEP - DIAL_W)
        return x + (w - inner) // 2

    def dial(self, mod, param, index, first_x, value):
        var = "%s_%s" % (mod["id"], param["id"])
        self.s.emit(
            '%s = dial("%s %s", "%s", at=(%d, %d), slot=(%d, %d), lo=%s, hi=%s, init=%s, unit=%s, exponent=%s)'
            % (var, mod["label"], param["label"], param.get("short", param["label"]),
               XC + index * DX, self.y + ROW, first_x + index * DIAL_STEP, DIAL_Y,
               pynum(param["min"]), pynum(param["max"]), pynum(value),
               UNITSTYLE[param["unit"]], pynum(param.get("exponent", 1.0))))
        return var

    def dials(self, mod, values, math_rows=0):
        """
        Open a module's section: its dials on top, `math_rows` rows of control math under
        them, and the signal objects under those, so every cord in the section runs
        downward. ctl(k) and sig(k) give the y of the k-th row of each band.
        """
        self.math_rows = math_rows
        first_x = self.open_card(mod)
        return {p["id"]: self.dial(mod, p, i, first_x, values[p["id"]]) for i, p in enumerate(mod["params"])}

    def ctl(self, k):
        return self.y + ROW + DIAL_ROW + k * ROW

    def sig(self, k):
        return self.ctl(self.math_rows) + k * ROW

    def end(self, sig_rows):
        """Height of the section just emitted, given how many signal rows it used."""
        return self.sig(sig_rows) - self.y + GAP

    def header(self, title):
        self.s.emit()
        self.s.emit("# ── %s %s" % (title, "─" * max(4, 72 - len(title))))
        self.s.emit('note("=== %s ===", %d, %d)' % (title.upper(), X["L"], self.y))

    # shared sub-circuits ------------------------------------------------------------

    def mix(self, prefix, mix_dial, mix_value, dry, wet, row, ctl_row=0):
        """
        Dry/wet crossfade for both channels: out = dry * (1 - mix) + wet * mix.
        `dry` and `wet` map a channel to the outlet expression carrying it. `row` is the
        signal row the crossfade starts on; `ctl_row` the control row its math starts on.
        Returns the outgoing signal and the number of signal rows used so far.
        """
        s = self.s
        m = mix_value / 100.0
        y = self.sig(row)
        s.place(prefix + "_wet", "* 0.01", XC + 2 * DX, self.ctl(ctl_row))
        s.place(prefix + "_dry", "!- 1.", XC + 2 * DX, self.ctl(ctl_row + 1))
        s.wire("%s.outs[0]" % mix_dial, "%s_wet.ins[0]" % prefix)
        s.wire("%s_wet.outs[0]" % prefix, "%s_dry.ins[0]" % prefix)
        out = {}
        for ch in ("L", "R"):
            d, w, a = "%s_dry%s" % (prefix, ch), "%s_wet%s" % (prefix, ch), "%s_out%s" % (prefix, ch)
            s.place(d, "*~ %s" % fnum(1 - m), X[ch], y)
            s.place(w, "*~ %s" % fnum(m), X[ch] + SUB, y)
            s.place(a, "+~", X[ch], y + ROW)
            s.wire(dry[ch], "%s.ins[0]" % d)
            s.wire(wet[ch], "%s.ins[0]" % w)
            s.wire("%s_dry.outs[0]" % prefix, "%s.ins[1]" % d)
            s.wire("%s_wet.outs[0]" % prefix, "%s.ins[1]" % w)
            s.wire("%s.outs[0]" % d, "%s.ins[0]" % a)
            s.wire("%s.outs[0]" % w, "%s.ins[1]" % a)
            out[ch] = "%s.outs[0]" % a
        return out, row + 2


# Each module takes the device, the incoming signal per channel, its options and values,
# and returns the outgoing signal per channel plus how many rows it used.

def m_filter(dev, src, opt, val):
    s = dev.s
    d = dev.dials(_module("filter"), val)
    outlet = {"lowpass": 0, "highpass": 1, "bandpass": 2, "notch": 3}[opt["mode"]]
    out = {}
    for ch in ("L", "R"):
        v = s.place("filter_" + ch, "svf~ %s %s" % (fnum(val["cutoff"]), fnum(val["res"])), X[ch], dev.sig(0))
        s.wire(src[ch], v + ".ins[0]")
        s.wire(d["cutoff"] + ".outs[0]", v + ".ins[1]")
        s.wire(d["res"] + ".outs[0]", v + ".ins[2]")
        out[ch] = "%s.outs[%d]" % (v, outlet)  # svf~ outlets: lowpass, highpass, bandpass, notch
    return out, 1


def m_drive(dev, src, opt, val):
    s = dev.s
    d = dev.dials(_module("drive"), val)
    out = {}
    for ch in ("L", "R"):
        if opt["character"] == "soft":
            g = s.place("drive_" + ch, "overdrive~ %s" % fnum(val["amount"]), X[ch], dev.sig(0))
            s.wire(src[ch], g + ".ins[0]")
            s.wire(d["amount"] + ".outs[0]", g + ".ins[1]")
            shaped = g + ".outs[0]"
        else:
            g = s.place("drive_" + ch, "*~ %s" % fnum(val["amount"]), X[ch], dev.sig(0))
            c = s.place("drive_clip" + ch, "clip~ -1. 1.", X[ch], dev.sig(1))
            s.wire(src[ch], g + ".ins[0]")
            s.wire(d["amount"] + ".outs[0]", g + ".ins[1]")
            s.wire(g + ".outs[0]", c + ".ins[0]")
            shaped = c + ".outs[0]"
        t = s.place("drive_tone" + ch, "onepole~ %s" % fnum(val["tone"]), X[ch], dev.sig(2))
        s.wire(shaped, t + ".ins[0]")
        s.wire(d["tone"] + ".outs[0]", t + ".ins[1]")
        out[ch] = t + ".outs[0]"
    return out, 3


def m_crush(dev, src, opt, val):
    s = dev.s
    d = dev.dials(_module("crush"), val, math_rows=1)
    s.place("crush_ratio", "* 0.01", XC, dev.ctl(0))
    s.wire(d["rate"] + ".outs[0]", "crush_ratio.ins[0]")
    out = {}
    for ch in ("L", "R"):
        v = s.place("crush_" + ch, "degrade~ %s %d" % (fnum(val["rate"] / 100.0), int(val["bits"])), X[ch], dev.sig(0))
        s.wire(src[ch], v + ".ins[0]")
        s.wire("crush_ratio.outs[0]", v + ".ins[1]")
        s.wire(d["bits"] + ".outs[0]", v + ".ins[2]")
        out[ch] = v + ".outs[0]"
    return out, 1


def m_chorus(dev, src, opt, val):
    s = dev.s
    d = dev.dials(_module("chorus"), val, math_rows=3)
    s.place("chorus_lfo", "cycle~ %s" % fnum(val["rate"]), XC, dev.ctl(0))
    s.place("chorus_depth_sig", "*~ %s" % fnum(val["depth"]), XC, dev.ctl(1))
    s.place("chorus_invert", "*~ -1.", XC, dev.ctl(2))
    s.wire(d["rate"] + ".outs[0]", "chorus_lfo.ins[0]")
    s.wire("chorus_lfo.outs[0]", "chorus_depth_sig.ins[0]")
    s.wire(d["depth"] + ".outs[0]", "chorus_depth_sig.ins[1]")
    s.wire("chorus_depth_sig.outs[0]", "chorus_invert.ins[0]")
    sweep = {"L": "chorus_depth_sig.outs[0]", "R": "chorus_invert.outs[0]"}
    wet = {}
    for ch in ("L", "R"):
        # The delay time, in ms, as a signal: 12 ms plus or minus the sweep.
        t = s.place("chorus_time" + ch, "+~ 12.", X[ch] + SUB, dev.sig(0))
        i = s.place("chorus_in" + ch, "tapin~ 100", X[ch], dev.sig(0))
        o = s.place("chorus_tap" + ch, "tapout~", X[ch], dev.sig(1))
        s.wire(sweep[ch], t + ".ins[0]")
        s.wire(src[ch], i + ".ins[0]")
        s.wire(i + ".outs[0]", o + ".ins[0]")
        s.wire(t + ".outs[0]", o + ".ins[0]")
        wet[ch] = o + ".outs[0]"
    return dev.mix("chorus", d["mix"], val["mix"], src, wet, 2)


def m_tremolo(dev, src, opt, val):
    s = dev.s
    d = dev.dials(_module("tremolo"), val, math_rows=2)
    half = val["depth"] / 200.0
    # gain = (1 - depth/2) + (depth/2) * sin, so full depth swings between 0 and 1.
    s.place("tremolo_lfo", "cycle~ %s" % fnum(val["rate"]), XC, dev.ctl(0))
    s.place("tremolo_half", "* 0.005", XC + DX, dev.ctl(0))
    s.place("tremolo_base", "!- 1.", XC + DX, dev.ctl(1))
    s.wire(d["rate"] + ".outs[0]", "tremolo_lfo.ins[0]")
    s.wire(d["depth"] + ".outs[0]", "tremolo_half.ins[0]")
    s.wire("tremolo_half.outs[0]", "tremolo_base.ins[0]")
    lfo = {"L": "tremolo_lfo.outs[0]", "R": "tremolo_lfo.outs[0]"}
    if opt["mode"] == "autopan":
        s.place("tremolo_invert", "*~ -1.", XC, dev.ctl(1))
        s.wire("tremolo_lfo.outs[0]", "tremolo_invert.ins[0]")
        lfo["R"] = "tremolo_invert.outs[0]"
    out = {}
    for ch in ("L", "R"):
        a = s.place("tremolo_swing" + ch, "*~ %s" % fnum(half), X[ch] + SUB, dev.sig(0))
        m = s.place("tremolo_gain" + ch, "+~ %s" % fnum(1 - half), X[ch] + SUB, dev.sig(1))
        v = s.place("tremolo_" + ch, "*~ 0.", X[ch], dev.sig(2))
        s.wire(lfo[ch], a + ".ins[0]")
        s.wire("tremolo_half.outs[0]", a + ".ins[1]")
        s.wire(a + ".outs[0]", m + ".ins[0]")
        s.wire("tremolo_base.outs[0]", m + ".ins[1]")
        s.wire(src[ch], v + ".ins[0]")
        s.wire(m + ".outs[0]", v + ".ins[1]")
        out[ch] = v + ".outs[0]"
    return out, 3


def m_delay(dev, src, opt, val):
    s = dev.s
    d = dev.dials(_module("delay"), val, math_rows=2)
    s.place("delay_fb", "* 0.01", XC + DX, dev.ctl(0))
    s.wire(d["feedback"] + ".outs[0]", "delay_fb.ins[0]")
    wet = {}
    for ch in ("L", "R"):
        i = s.place("delay_in" + ch, "tapin~ 2000", X[ch], dev.sig(0))
        o = s.place("delay_tap" + ch, "tapout~ %s" % fnum(val["time"]), X[ch], dev.sig(1))
        f = s.place("delay_fb" + ch, "*~ %s" % fnum(val["feedback"] / 100.0), X[ch] + SUB, dev.sig(2))
        s.wire(i + ".outs[0]", o + ".ins[0]")
        s.wire(d["time"] + ".outs[0]", o + ".ins[0]")
        s.wire(o + ".outs[0]", f + ".ins[0]")
        s.wire("delay_fb.outs[0]", f + ".ins[1]")
        wet[ch] = o + ".outs[0]"
    if opt["style"] == "pingpong":
        # Both inputs enter on the left; each side's echo feeds the other side's line.
        s.wire(src["L"], "delay_inL.ins[0]")
        s.wire(src["R"], "delay_inL.ins[0]")
        s.wire("delay_fbL.outs[0]", "delay_inR.ins[0]")
        s.wire("delay_fbR.outs[0]", "delay_inL.ins[0]")
    else:
        for ch in ("L", "R"):
            s.wire(src[ch], "delay_in%s.ins[0]" % ch)
            s.wire("delay_fb%s.outs[0]" % ch, "delay_in%s.ins[0]" % ch)
    return dev.mix("delay", d["mix"], val["mix"], src, wet, 3)


# Comb delay times in ms. The right channel's are slightly longer, which is what makes
# the tail wide instead of a mono reverb in both speakers.
COMBS = {"L": (29.7, 37.1, 41.1, 43.7), "R": (30.3, 37.9, 41.9, 44.5)}
ALLPASS = {"L": (5.0, 1.7), "R": (5.3, 1.9)}


def m_reverb(dev, src, opt, val):
    s = dev.s
    d = dev.dials(_module("reverb"), val, math_rows=2)
    fb = 0.7 + 0.28 * val["size"] / 100.0
    s.place("reverb_fb", "scale 0. 100. 0.7 0.98", XC, dev.ctl(0))
    s.wire(d["size"] + ".outs[0]", "reverb_fb.ins[0]")
    wet = {}
    for ch in ("L", "R"):
        total = s.place("reverb_sum" + ch, "*~ 0.25", X[ch], dev.sig(4))
        for n, ms in enumerate(COMBS[ch]):
            c = s.place("reverb_comb%s%d" % (ch, n + 1), "comb~ 60 %s 0. 1. %s" % (fnum(ms), fnum(fb)), X[ch], dev.sig(n))
            s.wire(src[ch], c + ".ins[0]")
            s.wire("reverb_fb.outs[0]", c + ".ins[4]")
            s.wire(c + ".outs[0]", total + ".ins[0]")
        a1 = s.place("reverb_apA" + ch, "allpass~ 20 %s 0.5" % fnum(ALLPASS[ch][0]), X[ch], dev.sig(5))
        a2 = s.place("reverb_apB" + ch, "allpass~ 20 %s 0.5" % fnum(ALLPASS[ch][1]), X[ch], dev.sig(6))
        dm = s.place("reverb_damp" + ch, "onepole~ %s" % fnum(val["damp"]), X[ch], dev.sig(7))
        s.wire(total + ".outs[0]", a1 + ".ins[0]")
        s.wire(a1 + ".outs[0]", a2 + ".ins[0]")
        s.wire(a2 + ".outs[0]", dm + ".ins[0]")
        s.wire(d["damp"] + ".outs[0]", dm + ".ins[1]")
        wet[ch] = dm + ".outs[0]"
    return dev.mix("reverb", d["mix"], val["mix"], src, wet, 8)


MODULES = {
    "filter": m_filter,
    "drive": m_drive,
    "crush": m_crush,
    "chorus": m_chorus,
    "tremolo": m_tremolo,
    "delay": m_delay,
    "reverb": m_reverb,
}


def script(settings):
    """The maxpylang program that builds the device these settings describe."""
    st = normalize(settings)
    sch = schema()
    dev = Device(st)
    s = dev.s
    active = [e for e in st["chain"] if e["on"]]

    s.emit('"""')
    s.emit("%s: a Max for Live audio effect, generated with MaxPyLang." % st["name"])
    s.emit("")
    s.emit("Signal flow: plugin~ -> %s -> clip~ -> plugout~"
           % " -> ".join([_module(e["module"])["label"].lower() for e in active] + ["output gain"]))
    s.emit("Run it with `pip install maxpylang`; it writes %s next to this file." % filename(st))
    s.emit('"""')
    s.emit(PREAMBLE)
    s.emit()
    s.emit("ACCENT = %r" % _rgba(st["accent"]))
    s.emit("CARD = [0.11, 0.12, 0.14, 1.0]")
    s.emit("INK = [0.93, 0.94, 0.96, 1.0]")
    s.emit("DIM = [0.55, 0.58, 0.63, 1.0]")

    # input
    dev.header("input")
    s.place("plug_in", "plugin~", X["L"], dev.y + ROW)
    s.emit('label(%s, (%d, %d), (8, 62, %d), size=12.0, bold=True, color=INK)' % (json.dumps(st["name"]), XP, dev.park_y, BRAND_W - 8))
    s.emit('label("MaxPyLang", (%d, %d), (8, 82, %d), size=9.0, color=DIM)' % (XP + 60, dev.park_y, BRAND_W - 8))
    dev.park_y += 30
    sig = {"L": "plug_in.outs[0]", "R": "plug_in.outs[1]"}
    dev.y += 2 * ROW + GAP

    for entry in active:
        mod = _module(entry["module"])
        dev.header(mod["label"])
        sig, rows = MODULES[mod["id"]](dev, sig, entry["options"], entry["values"])
        s.flush()
        dev.y += dev.end(rows)

    # output: gain in dB, a safety clip, and out to Live's mixer
    out = sch["output"]
    dev.header("output")
    d = dev.dials(out, st["output"], math_rows=1)
    s.place("output_amp", "dbtoa", XC, dev.ctl(0))
    s.wire(d["gain"] + ".outs[0]", "output_amp.ins[0]")
    amp = 10 ** (st["output"]["gain"] / 20.0)
    for ch in ("L", "R"):
        s.place("output_" + ch, "*~ %s" % fnum(amp), X[ch], dev.sig(0))
        s.place("output_clip" + ch, "clip~ -1. 1.", X[ch], dev.sig(1))
    s.place("plug_out", "plugout~", X["L"], dev.sig(2))
    for i, ch in enumerate(("L", "R")):
        g, c = "output_" + ch, "output_clip" + ch
        s.wire(sig[ch], g + ".ins[0]")
        s.wire("output_amp.outs[0]", g + ".ins[1]")
        s.wire(g + ".outs[0]", c + ".ins[0]")
        s.wire(c + ".outs[0]", "plug_out.ins[%d]" % i)
    s.flush()

    width = dev.card_x
    s.emit()
    s.emit("# ── device " + "─" * 66)
    s.emit("# Open in presentation mode, at the width the cards add up to. (gap M4L-04)")
    s.emit('patcher = patch._patcher_dict["patcher"]')
    s.emit('patcher["openinpresentation"] = 1')
    s.emit('patcher["devicewidth"] = %s' % pynum(width))
    s.emit()
    s.emit('patch.save(%s, device_type="audio_effect", verbose=False)' % json.dumps(filename(st)))
    return s.text()


# ── running it ──────────────────────────────────────────────────────────────────

def run(settings, want_amxd=True):
    """
    Execute script(settings) and report what it produced.

    Returns a dict: the script, the patcher JSON, the .amxd bytes (base64) when asked for,
    everything maxpylang printed or warned while building and checking the patch, and the
    type checks' coverage numbers. The page shows the last two as its "type check" panel,
    which is where a gap in what maxpylang can judge first becomes visible.
    """
    import maxpylang as mp

    st = normalize(settings)
    src = script(st)
    out = io.StringIO()
    ns = {"__name__": "__fxgen__"}
    cwd = os.getcwd()
    result = {"settings": st, "script": src, "filename": filename(st)}
    with tempfile.TemporaryDirectory() as tmp:
        os.chdir(tmp)
        try:
            with warnings.catch_warnings(record=True) as caught, contextlib.redirect_stdout(out):
                warnings.simplefilter("always")
                exec(compile(src, "<%s>" % filename(st), "exec"), ns)
            path = os.path.join(tmp, filename(st))
            if want_amxd:
                with open(path, "rb") as fh:
                    result["amxd"] = base64.b64encode(fh.read()).decode("ascii")
        finally:
            os.chdir(cwd)

    patch = ns["patch"]
    assert isinstance(patch, mp.MaxPatch)
    result["json"] = patch.get_json()
    result["log"] = out.getvalue()
    result["warnings"] = [{"category": w.category.__name__, "message": str(w.message)} for w in caught]
    try:
        result["coverage"] = json.loads(json.dumps(patch.get_coverage(), default=str))
    except Exception as err:  # the page still works without the numbers
        result["coverage"] = {"error": str(err)}
    return result


def run_json(settings_json, want_amxd=True):
    """run(), with JSON text in and out. The entry point the Pyodide worker calls."""
    return json.dumps(run(json.loads(settings_json), want_amxd))
