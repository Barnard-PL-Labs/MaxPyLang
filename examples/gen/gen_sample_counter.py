"""
gen_sample_counter.py
=====================
Count elapsed audio samples using the fundamental gen~ feedback pattern:
a `history` cell stores the previous sample's value, which is fed back into
an adder along with the current increment.

Signal chain (outer):
    sig~ 1 --> gen~ --> number~

Gen patcher (inner):

         in 1 ----+
                  |
    history <--+  |
       |       |  |
       +----> [+] |
               |  |
               +--+
               |
             out 1

    in 1 --> + (inlet 0)
    history --> + (inlet 1)
    + --> history  (feedback: store this sample's sum for next sample)
    + --> out 1    (output the running total)

Concept: `history` is gen~'s single-sample delay — it holds a value across
one sample period.  Connecting the adder output back through `history` creates
a one-sample feedback loop that acts as an accumulator.  With `sig~ 1` driving
the inlet (increment = 1 each sample), the output counts upward monotonically:
0, 1, 2, 3, …  Use `number~` to observe the running count.

Usage:
    python gen_sample_counter.py
    --> Generates gen_sample_counter.maxpat
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
        [60.0,  40.0],   # row 1 — in 1
        [60.0,  110.0],  # row 2 — + adder
        [200.0, 110.0],  # row 2 (right) — history
        [60.0,  180.0],  # row 3 — out 1
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
                "patching_rect": [x, y, 80.0, 22.0]
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
# Objects:
#   in 1    — receives the increment value from outside (1.0 per sample)
#   +       — adds current increment and previous accumulated sum
#   history — single-sample delay; holds last output so + can read it
#   out 1   — sends the running total out of gen~
#
# Connections:
#   in 1    --> + inlet 0   (new increment goes into left input of adder)
#   history --> + inlet 1   (previous sum goes into right input of adder)
#   +       --> history     (store this sample's sum for the next sample)
#   +       --> out 1       (output the running total)
gen_patcher = make_gen_patcher(
    boxes=[
        ("obj-g1", "in 1",   1, 1),  # increment input
        ("obj-g2", "+",      2, 1),  # accumulator adder (2 inlets: new + previous)
        ("obj-g3", "history", 1, 1), # 1-sample memory (holds previous sum)
        ("obj-g4", "out 1",  1, 0),  # output running count
    ],
    lines=[
        ("obj-g1", 0, "obj-g2", 0),  # in 1    --> + left inlet
        ("obj-g3", 0, "obj-g2", 1),  # history --> + right inlet
        ("obj-g2", 0, "obj-g3", 0),  # + output --> history (feedback)
        ("obj-g2", 0, "obj-g4", 0),  # + output --> out 1
    ]
)

# ---------------------------------------------------------------------------
# Build the outer Max patch
# ---------------------------------------------------------------------------
patch = mp.MaxPatch(verbose=False)

# Constant signal of 1.0 — increments the counter by 1 every sample
patch.set_position(30, 60)
sig = patch.place("sig~ 1", verbose=False)[0]

# gen~ accumulator
patch.set_position(30, 120)
gen_obj = patch.place("gen~", verbose=False)[0]
gen_obj._dict["box"]["patcher"] = gen_patcher

# number~ displays the current sample count (updates at signal rate)
patch.set_position(30, 180)
num = patch.place("number~", verbose=False)[0]

# Outer connections
patch.connect(
    [sig.outs[0],     gen_obj.ins[0]],  # constant 1 --> gen~ increment inlet
    [gen_obj.outs[0], num.ins[0]],      # count out --> number~ display
    verbose=False
)

# ---------------------------------------------------------------------------
# Save
# ---------------------------------------------------------------------------
patch.save("gen_sample_counter.maxpat", verbose=False, check=False)
print("Saved gen_sample_counter.maxpat")
print("  Inner gen: in 1 --> + <-- history (feedback loop), + --> out 1")
print("  Outer:     sig~ 1 --> gen~ --> number~")
print("  The counter increments by 1 every audio sample (44100 or 48000/sec).")
