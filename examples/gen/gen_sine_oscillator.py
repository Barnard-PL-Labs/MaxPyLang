"""
gen_sine_oscillator.py
======================
A sine-wave oscillator built entirely inside gen~ using a param, phasor, and
cycle operator chain.

Signal chain (outer):
    gen~ --> *~ 0.3 --> ezdac~

Gen patcher (inner):
    param freq 440 --> phasor --> cycle --> out 1

Concept: gen~ can generate audio from scratch without any external signal
source.  `param` exposes a named, automatable parameter with a default value.
`phasor` turns a frequency into a rising ramp (0..1 at that frequency).
`cycle` interprets that ramp as a phase index into a sine wavetable, producing
a clean sine tone.  Attenuating by 0.3 in the outer patch prevents clipping.

Usage:
    python gen_sine_oscillator.py
    --> Generates gen_sine_oscillator.maxpat
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
# Chain: param freq 440 --> phasor --> cycle --> out 1
#
# param:  0 inlets (value supplied by Max), 1 outlet (the parameter value)
# phasor: 1 inlet (frequency), 1 outlet (ramp 0..1)
# cycle:  1 inlet (phase 0..1), 1 outlet (sine value -1..1)
# out 1:  1 inlet, 0 outlets
gen_patcher = make_gen_patcher(
    boxes=[
        ("obj-g1", "param freq 440", 0, 1),  # named parameter, default 440 Hz
        ("obj-g2", "phasor",         1, 1),  # frequency-to-ramp converter
        ("obj-g3", "cycle",          1, 1),  # wavetable sine lookup
        ("obj-g4", "out 1",          1, 0),  # gen~ output
    ],
    lines=[
        ("obj-g1", 0, "obj-g2", 0),  # param freq --> phasor (frequency in)
        ("obj-g2", 0, "obj-g3", 0),  # phasor --> cycle (phase in)
        ("obj-g3", 0, "obj-g4", 0),  # cycle --> out 1
    ]
)

# ---------------------------------------------------------------------------
# Build the outer Max patch
# ---------------------------------------------------------------------------
patch = mp.MaxPatch(verbose=False)

# gen~ (self-contained oscillator — no audio input needed)
patch.set_position(30, 80)
gen_obj = patch.place("gen~", verbose=False)[0]
gen_obj._dict["box"]["patcher"] = gen_patcher  # inject gen sub-patcher

# Attenuator: *~ 0.3 keeps the sine wave well below clipping
patch.set_position(30, 140)
atten = patch.place("*~ 0.3", verbose=False)[0]

# Audio output
patch.set_position(30, 200)
dac = patch.place("ezdac~", verbose=False)[0]

# Outer connections
patch.connect(
    [gen_obj.outs[0], atten.ins[0]],  # gen~ sine out --> attenuator
    [atten.outs[0],   dac.ins[0]],    # attenuated signal --> ezdac~ left
    [atten.outs[0],   dac.ins[1]],    # attenuated signal --> ezdac~ right
    verbose=False
)

# ---------------------------------------------------------------------------
# Save
# ---------------------------------------------------------------------------
patch.save("gen_sine_oscillator.maxpat", verbose=False, check=False)
print("Saved gen_sine_oscillator.maxpat")
print("  Inner gen: param freq 440 --> phasor --> cycle --> out 1")
print("  Outer:     gen~ --> *~ 0.3 --> ezdac~")
print("  Tip: send 'freq <value>' to gen~ to change the oscillator frequency.")
