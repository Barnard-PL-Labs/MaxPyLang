"""
Gen~ Waveshaper Example
========================
Soft-clip distortion using tanh waveshaping inside gen~.

Multiplying the input signal by a drive factor increases its amplitude
before waveshaping. The tanh function compresses large values toward ±1
with a smooth S-curve, producing warm harmonic distortion rather than
the harsh clipping of a hard limiter.

At low drive values the signal passes through nearly unchanged.
At high drive values (10+) it approaches a square wave.

Signal chain (gen~ interior):
    in 1 ──→ * ──→ tanh → out 1
              ↑
    param drive 3

Signal chain (outer patch):
    cycle~ 220 → gen~ → *~ 0.3 → ezdac~

Usage:
    python main.py
    → Generates gen_waveshaper.maxpat
    → Open in Max/MSP; you will hear a distorted 220 Hz tone
    → Send floats to gen~'s drive param to adjust distortion amount:
        1.0  = clean (barely any shaping)
        3.0  = mild overdrive (default)
        10.0 = heavy saturation
"""

import maxpylang as mp

# =====================================================================
# GEN~ INTERIOR: tanh soft-clip waveshaper
# =====================================================================
gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)

# in 1 receives the raw audio signal to be shaped
gen_patch.set_position(60, 50)
gen_in = gen_patch.place("in 1", verbose=False)[0]

# param drive sets the pre-gain before tanh shaping (default: 3)
# Higher drive = more compression = more harmonic distortion
gen_patch.set_position(240, 50)
drive_param = gen_patch.place("param drive 3", verbose=False)[0]

# * multiplies the audio by the drive factor, boosting the amplitude
# This is what pushes the signal into the nonlinear tanh region
gen_patch.set_position(150, 140)
mul = gen_patch.place("*", verbose=False)[0]

# tanh is the hyperbolic tangent: outputs in (-1, 1), smooth S-curve
# Small inputs → nearly linear; large inputs → compressed toward ±1
gen_patch.set_position(150, 220)
th = gen_patch.place("tanh", verbose=False)[0]

# Output the shaped (soft-clipped) signal
gen_patch.set_position(150, 300)
gen_out = gen_patch.place("out 1", verbose=False)[0]

# Wire: in 1 → left inlet of *,  param drive → right inlet of *
#       * → tanh → out 1
gen_patch.connect(
    [gen_in.outs[0],     mul.ins[0]],    # audio → multiplier left inlet
    [drive_param.outs[0], mul.ins[1]],   # drive amount → multiplier right inlet
    [mul.outs[0],         th.ins[0]],    # driven signal → tanh shaper
    [th.outs[0],          gen_out.ins[0]], # shaped signal → output
    verbose=False,
)

# =====================================================================
# OUTER PATCH
# =====================================================================
patch = mp.MaxPatch(verbose=False)

# === SIGNAL SOURCE ===
patch.set_position(30, 30)
patch.place("comment === SIGNAL SOURCE ===", verbose=False)[0]

patch.set_position(30, 60)
# 220 Hz sine wave (A3) — a clean input to feed into the waveshaper
osc = patch.place("cycle~ 220", verbose=False)[0]

# === GEN~ WAVESHAPER ===
patch.set_position(30, 130)
patch.place("comment === GEN~ WAVESHAPER ===", verbose=False)[0]

patch.set_position(30, 160)
gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]

# === GAIN CONTROL ===
patch.set_position(30, 230)
patch.place("comment === GAIN CONTROL ===", verbose=False)[0]

patch.set_position(30, 260)
# tanh output is already bounded in (-1, 1), attenuate further for safe listening
gain = patch.place("*~ 0.3", verbose=False)[0]

# === OUTPUT ===
patch.set_position(30, 330)
patch.place("comment === OUTPUT ===", verbose=False)[0]

patch.set_position(30, 360)
dac = patch.place("ezdac~", verbose=False)[0]

# === CONNECTIONS ===
patch.connect(
    [osc.outs[0],     gen_obj.ins[0]],  # 220 Hz sine → waveshaper input
    [gen_obj.outs[0], gain.ins[0]],     # shaped signal → attenuator
    [gain.outs[0],    dac.ins[0]],      # attenuated signal → left speaker
    [gain.outs[0],    dac.ins[1]],      # attenuated signal → right speaker
    verbose=False,
)

# === SAVE ===
patch.save("gen_waveshaper.maxpat")
