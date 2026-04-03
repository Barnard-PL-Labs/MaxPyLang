"""
gen_bounded_ramp.py
===================
A ramp that rises steadily then wraps back to zero — a manual phasor built
from first principles using history feedback and a wrap operator.

Signal chain (outer):
    gen~ --> scope~

Gen patcher (inner):

    param rate 0.001 --> + (inlet 0)
    history           --> + (inlet 1)
    + --> wrap 0 1    (keep value in [0, 1))
    wrap --> history  (feed wrapped value back for next sample)
    wrap --> out 1    (output the ramp)

Concept: Each sample, `param rate` is added to the value stored in `history`.
`wrap 0 1` clamps the result to the range [0, 1) by wrapping — when the ramp
reaches 1.0 it jumps back to 0.0 rather than growing forever.  The resulting
waveform is a sawtooth (rising ramp) whose frequency equals
  freq = rate * samplerate  (e.g. 0.001 * 44100 = 44.1 Hz)
Use `scope~` in the outer patch to visualise the triangle/sawtooth shape.

Usage:
    python gen_bounded_ramp.py
    --> Generates gen_bounded_ramp.maxpat
"""

import sys
sys.path.insert(0, "../..")
import maxpylang as mp


# ---------------------------------------------------------------------------
# Helper: build a gen patcher dict directly
# ---------------------------------------------------------------------------
def make_gen_patcher(boxes, lines, classnamespace="dsp.gen"):
    """
    Build a minimal gen patcher dict from box and patchline descriptors.

    boxes: list of (obj_id, text, numinlets, numoutlets)
    lines: list of (src_id, src_outlet, dst_id, dst_inlet)
    classnamespace: gen type string (default "dsp.gen")
    """
    patcher = {
        "fileversion": 1,
        "appversion": {
            "major": 8, "minor": 1, "revision": 11,
            "architecture": "x64", "modernui": 1
        },
        "classnamespace": classnamespace,
        "rect": [0.0, 0.0, 600.0, 450.0],
        "bglocked": 0,
        "openinpresentation": 0,
        "default_fontsize": 12.0,
        "default_fontface": 0,
        "default_fontname": "Arial",
        "boxes": [],
        "lines": []
    }

    positions = [
        [60.0,  40.0],   # param rate
        [60.0,  110.0],  # + adder
        [220.0, 110.0],  # history
        [60.0,  180.0],  # wrap 0 1
        [60.0,  250.0],  # out 1
    ]

    for i, (obj_id, text, numinlets, numoutlets) in enumerate(boxes):
        x, y = positions[i] if i < len(positions) else [60.0 + i * 80.0, 40.0]
        patcher["boxes"].append({
            "box": {
                "id": obj_id,
                "maxclass": "newobj",
                "numinlets": numinlets,
                "numoutlets": numoutlets,
                "outlettype": [""] * numoutlets,
                "text": text,
                "patching_rect": [x, y, 100.0, 22.0]
            }
        })

    for src_id, src_outlet, dst_id, dst_inlet in lines:
        patcher["lines"].append({
            "patchline": {
                "source": [src_id, src_outlet],
                "destination": [dst_id, dst_inlet]
            }
        })

    return patcher


# ---------------------------------------------------------------------------
# Build the gen~ inner patcher
# ---------------------------------------------------------------------------
# param rate 0.001 — increment added each sample (controls ramp frequency)
# +                — adds rate increment to previous ramp value
# history          — single-sample delay stores the previous ramp value
# wrap 0 1         — keeps ramp in [0, 1), resetting to 0 at the top
# out 1            — outputs the ramp signal
#
# At 44100 Hz sample rate, rate=0.001 produces a ~44.1 Hz sawtooth wave.
gen_patcher = make_gen_patcher(
    boxes=[
        ("obj-g1", "param rate 0.001", 0, 1),  # rate param (increment/sample)
        ("obj-g2", "+",               2, 1),   # accumulator adder
        ("obj-g3", "history",         1, 1),   # 1-sample memory (previous sum)
        ("obj-g4", "wrap 0 1",        1, 1),   # constrain to [0, 1)
        ("obj-g5", "out 1",           1, 0),   # ramp output
    ],
    lines=[
        ("obj-g1", 0, "obj-g2", 0),  # param rate --> + left inlet (increment)
        ("obj-g3", 0, "obj-g2", 1),  # history    --> + right inlet (previous value)
        ("obj-g2", 0, "obj-g4", 0),  # +          --> wrap 0 1
        ("obj-g4", 0, "obj-g3", 0),  # wrap       --> history (feedback: store wrapped value)
        ("obj-g4", 0, "obj-g5", 0),  # wrap       --> out 1
    ]
)

# ---------------------------------------------------------------------------
# Build the outer Max patch
# ---------------------------------------------------------------------------
patch = mp.MaxPatch(verbose=False)

# gen~ bounded ramp (no audio input needed — driven by param internally)
patch.set_position(30, 80)
gen_obj = patch.place("gen~", verbose=False)[0]
gen_obj._dict["box"]["patcher"] = gen_patcher

# scope~ visualises the sawtooth waveform
patch.set_position(30, 150)
scope = patch.place("scope~", verbose=False)[0]

# Outer connections
patch.connect(
    [gen_obj.outs[0], scope.ins[0]],  # ramp --> oscilloscope
    verbose=False
)

# ---------------------------------------------------------------------------
# Save
# ---------------------------------------------------------------------------
patch.save("gen_bounded_ramp.maxpat", verbose=False, check=False)
print("Saved gen_bounded_ramp.maxpat")
print("  Inner gen: param rate 0.001 --> + <-- history, + --> wrap 0 1 --> history + out 1")
print("  Outer:     gen~ --> scope~")
print("  Default rate 0.001 at 44100 Hz = ~44.1 Hz sawtooth.")
print("  Tip: send 'rate <value>' to gen~ to change the ramp speed.")
