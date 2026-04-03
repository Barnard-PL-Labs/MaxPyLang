"""
gen_passthrough.py
==================
Simplest possible gen~ patch: audio passes straight through without modification.

Signal chain (outer):
    cycle~ 440 --> gen~ --> ezdac~

Gen patcher (inner):
    in 1 --> out 1

Concept: The identity patch — demonstrates the minimum viable gen~ structure:
one inlet, one outlet, directly connected. Useful as a starting template.

Usage:
    python gen_passthrough.py
    --> Generates gen_passthrough.maxpat
"""

import sys
sys.path.insert(0, "../..")
import maxpylang as mp


# ---------------------------------------------------------------------------
# Helper: build a gen patcher dict directly (bypasses MaxPyLang object lookup
# for gen operators, which are not in the standard OBJ_INFO index).
# ---------------------------------------------------------------------------
def make_gen_patcher(boxes, lines, classnamespace="dsp.gen"):
    """
    Build a minimal gen patcher dict from a list of box descriptors and
    patchline descriptors.

    boxes: list of (obj_id, text, numinlets, numoutlets)
    lines: list of (src_id, src_outlet, dst_id, dst_inlet)
    classnamespace: gen type string (default "dsp.gen")

    Returns a dict shaped like the "patcher" value inside a .maxpat file.
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

    for col, (obj_id, text, numinlets, numoutlets) in enumerate(boxes):
        patcher["boxes"].append({
            "box": {
                "id": obj_id,
                "maxclass": "newobj",
                "numinlets": numinlets,
                "numoutlets": numoutlets,
                "outlettype": [""] * numoutlets,
                "text": text,
                "patching_rect": [50.0 + col * 130.0, 80.0 + col * 60.0, 80.0, 22.0]
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
# Boxes: (id, text, numinlets, numoutlets)
# "in 1" has 1 inlet, 1 outlet; "out 1" has 1 inlet, 0 outlets
gen_patcher = make_gen_patcher(
    boxes=[
        ("obj-g1", "in 1",  1, 1),   # signal inlet
        ("obj-g2", "out 1", 1, 0),   # signal outlet
    ],
    lines=[
        ("obj-g1", 0, "obj-g2", 0),  # in 1 --> out 1
    ]
)

# ---------------------------------------------------------------------------
# Build the outer Max patch
# ---------------------------------------------------------------------------
patch = mp.MaxPatch(verbose=False)

# Source oscillator
patch.set_position(30, 80)
osc = patch.place("cycle~ 440", verbose=False)[0]

# gen~ object — embed the hand-built patcher dict directly
patch.set_position(30, 140)
gen_obj = patch.place("gen~", verbose=False)[0]
gen_obj._dict["box"]["patcher"] = gen_patcher  # inject gen sub-patcher

# Audio output
patch.set_position(30, 200)
dac = patch.place("ezdac~", verbose=False)[0]

# Outer connections (these objects ARE known, so connect() works normally)
patch.connect(
    [osc.outs[0], gen_obj.ins[0]],   # oscillator --> gen~
    [gen_obj.outs[0], dac.ins[0]],   # gen~ --> ezdac~
    verbose=False
)

# ---------------------------------------------------------------------------
# Save
# ---------------------------------------------------------------------------
patch.save("gen_passthrough.maxpat", verbose=False, check=False)
print("Saved gen_passthrough.maxpat")
print("  Inner gen: in 1 --> out 1  (identity/passthrough)")
print("  Outer:     cycle~ 440 --> gen~ --> ezdac~")
