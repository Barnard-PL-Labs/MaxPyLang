"""
Gen~ Sine Oscillator Example
==============================
A self-contained sine oscillator built entirely inside gen~.
The frequency is controlled by a param object, making it tweakable
from the outer patch. This demonstrates how gen~ can encapsulate
a complete synthesis algorithm.

Signal chain (gen~ interior):
    param freq 440 → phasor → cycle → out 1

Signal chain (outer patch):
    gen~ → *~ 0.3 → ezdac~

Usage:
    python main.py
    → Generates gen_sine_oscillator.maxpat
    → Open in Max/MSP and click the ezdac~ to hear a 440 Hz sine wave
    → Send a float to gen~'s freq param to change pitch
"""

import maxpylang as mp

# =====================================================================
# GEN~ INTERIOR: self-contained sine oscillator
# =====================================================================
gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)

# Declare a named parameter for frequency (default 440 Hz)
gen_patch.set_position(100, 50)
freq_param = gen_patch.place("param freq 440", verbose=False)[0]

# phasor generates a 0→1 sawtooth ramp at the given frequency
gen_patch.set_position(100, 120)
ph = gen_patch.place("phasor", verbose=False)[0]

# cycle uses the phasor ramp as a phase index into one sine period
gen_patch.set_position(100, 190)
cyc = gen_patch.place("cycle", verbose=False)[0]

# Output port
gen_patch.set_position(100, 260)
gen_out = gen_patch.place("out 1", verbose=False)[0]

# Wire: param freq → phasor (frequency input) → cycle (phase input) → out
gen_patch.connect(
    [freq_param.outs[0], ph.ins[0]],   # frequency → phasor
    [ph.outs[0],         cyc.ins[0]],  # phasor ramp → cycle phase
    [cyc.outs[0],        gen_out.ins[0]], # sine output → gen outlet
    verbose=False,
)

# =====================================================================
# OUTER PATCH
# =====================================================================
patch = mp.MaxPatch(verbose=False)

# === GEN~ OSCILLATOR ===
patch.set_position(30, 30)
patch.place("comment === GEN~ OSCILLATOR ===", verbose=False)[0]

patch.set_position(30, 60)
gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]

# === GAIN CONTROL ===
patch.set_position(30, 130)
patch.place("comment === GAIN CONTROL ===", verbose=False)[0]

patch.set_position(30, 160)
# Attenuate to a safe listening level before sending to speakers
gain = patch.place("*~ 0.3", verbose=False)[0]

# === OUTPUT ===
patch.set_position(30, 230)
patch.place("comment === OUTPUT ===", verbose=False)[0]

patch.set_position(30, 260)
dac = patch.place("ezdac~", verbose=False)[0]

# === CONNECTIONS ===
patch.connect(
    [gen_obj.outs[0], gain.ins[0]],    # gen~ sine → attenuator
    [gain.outs[0],    dac.ins[0]],     # attenuated signal → left speaker
    [gain.outs[0],    dac.ins[1]],     # attenuated signal → right speaker
    verbose=False,
)

# === SAVE ===
patch.save("gen_sine_oscillator.maxpat")
