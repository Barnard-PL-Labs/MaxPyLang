"""
Gen~ Passthrough Example
========================
The simplest possible gen~ patch: audio enters, passes through unchanged,
and exits. This illustrates the basic input/output pattern inside gen~.

Signal chain (gen~ interior):
    in 1 → out 1

Signal chain (outer patch):
    cycle~ 440 → gen~ → ezdac~

Usage:
    python main.py
    → Generates gen_passthrough.maxpat
    → Open in Max/MSP and click the ezdac~ to hear a 440 Hz tone
"""

import maxpylang as mp

# =====================================================================
# GEN~ INTERIOR: build the sub-patcher that runs inside gen~
# =====================================================================
gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)

# Place gen input and output ports
gen_patch.set_position(100, 80)
gen_in = gen_patch.place("in 1", verbose=False)[0]   # audio inlet of gen~

gen_patch.set_position(100, 180)
gen_out = gen_patch.place("out 1", verbose=False)[0]  # audio outlet of gen~

# Wire in 1 → out 1 (direct passthrough — no processing)
gen_patch.connect(
    [gen_in.outs[0], gen_out.ins[0]],   # signal passes through unmodified
    verbose=False,
)

# =====================================================================
# OUTER PATCH: the Max patcher that hosts gen~
# =====================================================================
patch = mp.MaxPatch(verbose=False)

# === SIGNAL SOURCE ===
patch.set_position(30, 30)
patch.place("comment === SIGNAL SOURCE ===", verbose=False)[0]

patch.set_position(30, 60)
osc = patch.place("cycle~ 440", verbose=False)[0]   # 440 Hz test tone

# === GEN~ PROCESSOR ===
patch.set_position(30, 120)
patch.place("comment === GEN~ PROCESSOR ===", verbose=False)[0]

patch.set_position(30, 150)
# Embed the gen sub-patcher into the gen~ object
gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]

# === OUTPUT ===
patch.set_position(30, 220)
patch.place("comment === OUTPUT ===", verbose=False)[0]

patch.set_position(30, 250)
dac = patch.place("ezdac~", verbose=False)[0]

# === CONNECTIONS ===
patch.connect(
    [osc.outs[0],     gen_obj.ins[0]],  # test tone → gen~ inlet
    [gen_obj.outs[0], dac.ins[0]],      # gen~ left outlet → speaker left
    [gen_obj.outs[0], dac.ins[1]],      # gen~ right outlet → speaker right
    verbose=False,
)

# === SAVE ===
patch.save("gen_passthrough.maxpat")
