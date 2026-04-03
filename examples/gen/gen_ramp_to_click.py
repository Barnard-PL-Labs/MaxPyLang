"""
gen_ramp_to_click.py
====================
Convert a phasor's wrap-around discontinuity into a brief impulse (click),
using the `delta` operator and a threshold comparison.

Signal chain (outer):
    gen~ --> *~ 0.5 --> ezdac~

Gen patcher (inner):
    param rate 2 --> phasor --> delta --> abs --> > 0.5 --> out 1

Concept: `phasor` produces a rising ramp from 0 to 1 at the given rate (Hz).
When the ramp wraps from ~1 back to ~0, it makes a large downward jump of
approximately -1.0.  `delta` measures the per-sample change, so at the wrap
point it outputs a large negative value (~-1).  `abs` makes that positive
(~+1), and `> 0.5` fires a 1-sample pulse of value 1 whenever the absolute
delta exceeds 0.5 — i.e., exactly at each wrap event.  The result is a
click/impulse train at the phasor frequency.

At 2 Hz (default) you hear two faint clicks per second through ezdac~.
Raise `rate` to produce a pitched buzz (e.g. rate 110 gives 110 Hz clicks).

Usage:
    python gen_ramp_to_click.py
    --> Generates gen_ramp_to_click.maxpat
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

    for i, (obj_id, text, numinlets, numoutlets) in enumerate(boxes):
        patcher["boxes"].append({
            "box": {
                "id": obj_id,
                "maxclass": "newobj",
                "numinlets": numinlets,
                "numoutlets": numoutlets,
                "outlettype": [""] * numoutlets,
                "text": text,
                "patching_rect": [60.0, 40.0 + i * 60.0, 110.0, 22.0]
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
# Chain: param rate 2 --> phasor --> delta --> abs --> > 0.5 --> out 1
#
# param rate 2: rate parameter, default 2 Hz
# phasor:       frequency-to-ramp (0..1), wraps sharply each period
# delta:        sample-by-sample difference; large (~-1) at phasor wrap
# abs:          rectify so wrap jump is always positive
# > 0.5:        threshold — outputs 1 only when delta > 0.5 (at wrap point)
# out 1:        impulse output
gen_patcher = make_gen_patcher(
    boxes=[
        ("obj-g1", "param rate 2", 0, 1),  # rate in Hz (default 2)
        ("obj-g2", "phasor",       1, 1),  # linear ramp 0..1 at rate Hz
        ("obj-g3", "delta",        1, 1),  # per-sample difference
        ("obj-g4", "abs",          1, 1),  # absolute value (rectify)
        ("obj-g5", "> 0.5",        2, 1),  # threshold: 1 if abs delta > 0.5
        ("obj-g6", "out 1",        1, 0),  # impulse output
    ],
    lines=[
        ("obj-g1", 0, "obj-g2", 0),  # param rate --> phasor frequency
        ("obj-g2", 0, "obj-g3", 0),  # phasor --> delta
        ("obj-g3", 0, "obj-g4", 0),  # delta  --> abs
        ("obj-g4", 0, "obj-g5", 0),  # abs    --> > 0.5 (left inlet: signal)
        ("obj-g5", 0, "obj-g6", 0),  # > 0.5  --> out 1
    ]
)

# ---------------------------------------------------------------------------
# Build the outer Max patch
# ---------------------------------------------------------------------------
patch = mp.MaxPatch(verbose=False)

# gen~ impulse generator
patch.set_position(30, 80)
gen_obj = patch.place("gen~", verbose=False)[0]
gen_obj._dict["box"]["patcher"] = gen_patcher

# Attenuate to a comfortable level before sending to the DAC
patch.set_position(30, 140)
atten = patch.place("*~ 0.5", verbose=False)[0]

# Audio output
patch.set_position(30, 200)
dac = patch.place("ezdac~", verbose=False)[0]

# Outer connections
patch.connect(
    [gen_obj.outs[0], atten.ins[0]],   # impulses --> attenuator
    [atten.outs[0],   dac.ins[0]],     # attenuated --> ezdac~ left
    [atten.outs[0],   dac.ins[1]],     # attenuated --> ezdac~ right
    verbose=False
)

# ---------------------------------------------------------------------------
# Save
# ---------------------------------------------------------------------------
patch.save("gen_ramp_to_click.maxpat", verbose=False, check=False)
print("Saved gen_ramp_to_click.maxpat")
print("  Inner gen: param rate 2 --> phasor --> delta --> abs --> > 0.5 --> out 1")
print("  Outer:     gen~ --> *~ 0.5 --> ezdac~")
print("  Default: 2 clicks per second.  Tip: send 'rate 110' to gen~ for a 110 Hz click tone.")
