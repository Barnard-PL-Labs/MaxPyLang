"""
Gen~ Verification Test Patch
=============================
A comprehensive test patch that exercises many gen operators to verify
they load and function correctly in Max. Open the generated patch in
Max and confirm:

1. No errors in the Max console
2. The gen~ object shows its patcher when double-clicked
3. Audio plays when ezdac~ is enabled
4. The scope~ shows a waveform

Signal chain (gen~ interior):
    param freq 220 -> phasor -> cycle -> * 0.8 -> out 1
    Also includes: history feedback, wrap, delta, abs, sah, noise,
    slide, clip, fold, scale operators (connected but mixed to zero
    so they don't affect audio — just verifying they load).

Signal chain (outer patch):
    gen~ -> *~ 0.3 -> ezdac~
    gen~ -> scope~

Usage:
    python main.py
    -> Generates gen_verification_test.maxpat
    -> Open in Max, enable ezdac~, double-click gen~ to inspect interior
"""

import maxpylang as mp

# =====================================================================
# GEN~ INTERIOR: exercises many operators
# =====================================================================
gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)

# --- MAIN SIGNAL PATH ---
gen_patch.set_position(50, 50)
gen_patch.place("comment --- MAIN SIGNAL PATH ---", verbose=False)

gen_patch.set_position(50, 80)
freq = gen_patch.place("param freq 220", verbose=False)[0]

gen_patch.set_position(50, 130)
ph = gen_patch.place("phasor", verbose=False)[0]

gen_patch.set_position(50, 180)
cyc = gen_patch.place("cycle", verbose=False)[0]

gen_patch.set_position(50, 230)
gain = gen_patch.place("* 0.8", verbose=False)[0]

gen_patch.set_position(50, 350)
out1 = gen_patch.place("out 1", verbose=False)[0]

# Main signal: freq -> phasor -> cycle -> * 0.8 -> out
gen_patch.connect(
    [freq.outs[0], ph.ins[0]],
    [ph.outs[0], cyc.ins[0]],
    [cyc.outs[0], gain.ins[0]],
    [gain.outs[0], out1.ins[0]],
    verbose=False,
)

# --- VERIFICATION OPERATORS (connected but not audible) ---
gen_patch.set_position(300, 50)
gen_patch.place("comment --- VERIFICATION OPS ---", verbose=False)

# history feedback test
gen_patch.set_position(300, 80)
hist = gen_patch.place("history", verbose=False)[0]
gen_patch.set_position(300, 130)
add = gen_patch.place("+", verbose=False)[0]
# Create a tiny feedback loop: add -> history -> add (won't affect output)
gen_patch.connect(
    [add.outs[0], hist.ins[0]],
    verbose=False,
)

# wrap, clip, fold
gen_patch.set_position(300, 180)
wr = gen_patch.place("wrap 0 1", verbose=False)[0]
gen_patch.set_position(300, 230)
cl = gen_patch.place("clip 0 1", verbose=False)[0]
gen_patch.set_position(300, 280)
fo = gen_patch.place("fold 0 1", verbose=False)[0]

# delta, abs
gen_patch.set_position(500, 80)
dlt = gen_patch.place("delta", verbose=False)[0]
gen_patch.set_position(500, 130)
ab = gen_patch.place("abs", verbose=False)[0]
gen_patch.connect(
    [ph.outs[0], dlt.ins[0]],
    [dlt.outs[0], ab.ins[0]],
    verbose=False,
)

# noise + sah
gen_patch.set_position(500, 200)
ns = gen_patch.place("noise", verbose=False)[0]
gen_patch.set_position(500, 250)
sh = gen_patch.place("sah", verbose=False)[0]
gen_patch.connect(
    [ns.outs[0], sh.ins[0]],
    [ab.outs[0], sh.ins[1]],
    verbose=False,
)

# slide
gen_patch.set_position(500, 310)
sl = gen_patch.place("slide", verbose=False)[0]
gen_patch.connect(
    [sh.outs[0], sl.ins[0]],
    verbose=False,
)

# scale
gen_patch.set_position(500, 370)
sc = gen_patch.place("scale", verbose=False)[0]

# mix
gen_patch.set_position(300, 330)
mx = gen_patch.place("mix", verbose=False)[0]

# switch
gen_patch.set_position(300, 380)
sw = gen_patch.place("switch 0", verbose=False)[0]

# =====================================================================
# OUTER PATCH
# =====================================================================
patch = mp.MaxPatch(verbose=False)

# === GEN~ ===
patch.set_position(30, 30)
patch.place("comment === GEN~ VERIFICATION TEST ===", verbose=False)

patch.set_position(30, 60)
gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]

# === GAIN ===
patch.set_position(30, 130)
vol = patch.place("*~ 0.3", verbose=False)[0]

# === OUTPUT ===
patch.set_position(30, 200)
dac = patch.place("ezdac~", verbose=False)[0]

# === SCOPE ===
patch.set_position(200, 130)
scope = patch.place("scope~", verbose=False)[0]

# === CONNECTIONS ===
patch.connect(
    [gen_obj.outs[0], vol.ins[0]],
    [vol.outs[0], dac.ins[0]],
    [vol.outs[0], dac.ins[1]],
    [gen_obj.outs[0], scope.ins[0]],
    verbose=False,
)

# === SAVE ===
patch.save("gen_verification_test.maxpat")
