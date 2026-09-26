"""
Gen~ One-Pole Lowpass Filter Example
======================================
A one-pole IIR lowpass filter built from first principles inside gen~.
The classic feedback formula y[n] = y[n-1] + c * (x[n] - y[n-1]) is
wired explicitly using gen~ math and history operators, making the
signal flow transparent and educational.

One-pole formula:
    error      = x[n] - y[n-1]          (how far input is from last output)
    correction = error * cutoff          (fraction of error to close this sample)
    y[n]       = y[n-1] + correction    (new output: previous + correction)

Signal chain (gen~ interior):
    in 1  ──────────────────────┐
                                ▼
    history ──► - (error) ──► * (correction) ──► + (new output) ──► out 1
       ▲        │               ▲                  │
       │        └───────────────┘    param cutoff  │
       └────────────────────────────────────────────┘  (feedback)

Signal chain (outer patch):
    noise~ → gen~ → *~ 0.5 → ezdac~

Usage:
    python main.py
    → Generates gen_onepole_filter.maxpat
    → Open in Max/MSP and click the ezdac~ to hear filtered white noise
    → Send a float 0-1 to gen~'s cutoff param to sweep the filter
      (low values = dark/muffled, high values = bright/full spectrum)
"""

import maxpylang as mp

# =====================================================================
# GEN~ INTERIOR: one-pole lowpass filter
# =====================================================================
gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)

# --- INPUTS ---
gen_patch.set_position(80, 50)
gen_patch.place("comment --- INPUTS ---", verbose=False)[0]

gen_patch.set_position(80, 80)
gen_in = gen_patch.place("in 1", verbose=False)[0]       # audio input

# cutoff coefficient: 0 = frozen (no update), 1 = no smoothing (bypass)
gen_patch.set_position(300, 80)
cutoff_param = gen_patch.place("param cutoff 0.1", verbose=False)[0]

# --- FEEDBACK STATE ---
gen_patch.set_position(80, 160)
gen_patch.place("comment --- FEEDBACK STATE ---", verbose=False)[0]

gen_patch.set_position(80, 190)
# history holds the previous output sample, initialised to 0
hist = gen_patch.place("history", verbose=False)[0]

# --- FILTER MATH ---
gen_patch.set_position(80, 270)
gen_patch.place("comment --- FILTER MATH ---", verbose=False)[0]

# error = x[n] - y[n-1]
gen_patch.set_position(80, 300)
sub = gen_patch.place("-", verbose=False)[0]

# correction = error * cutoff
gen_patch.set_position(80, 370)
mul = gen_patch.place("*", verbose=False)[0]

# new output = y[n-1] + correction
gen_patch.set_position(80, 440)
add = gen_patch.place("+", verbose=False)[0]

# --- OUTPUT ---
gen_patch.set_position(80, 530)
gen_patch.place("comment --- OUTPUT ---", verbose=False)[0]

gen_patch.set_position(80, 560)
gen_out = gen_patch.place("out 1", verbose=False)[0]

# Wire error computation: in1 - prev_output
gen_patch.connect(
    [gen_in.outs[0], sub.ins[0]],    # x[n]    → subtract left inlet
    [hist.outs[0],   sub.ins[1]],    # y[n-1]  → subtract right inlet (x - prev)
    verbose=False,
)

# Wire correction: error * cutoff
gen_patch.connect(
    [sub.outs[0],        mul.ins[0]],  # error   → multiply left inlet
    [cutoff_param.outs[0], mul.ins[1]], # cutoff  → multiply right inlet
    verbose=False,
)

# Wire new output: prev + correction, then feed back into history
gen_patch.connect(
    [hist.outs[0], add.ins[0]],    # y[n-1]     → add left inlet
    [mul.outs[0],  add.ins[1]],    # correction → add right inlet
    verbose=False,
)

# Feedback: new output → history (closes the loop)
gen_patch.connect(
    [add.outs[0], hist.ins[0]],    # y[n] → history (feedback)
    verbose=False,
)

# To output
gen_patch.connect(
    [add.outs[0], gen_out.ins[0]], # y[n] → gen outlet
    verbose=False,
)

# =====================================================================
# OUTER PATCH: filter white noise
# =====================================================================
patch = mp.MaxPatch(verbose=False)

# === NOISE SOURCE ===
patch.set_position(30, 30)
patch.place("comment === NOISE SOURCE ===", verbose=False)[0]

patch.set_position(30, 60)
noise = patch.place("noise~", verbose=False)[0]          # broadband white noise

# === GEN~ FILTER ===
patch.set_position(30, 130)
patch.place("comment === GEN~ FILTER ===", verbose=False)[0]

patch.set_position(30, 160)
gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]

# === GAIN CONTROL ===
patch.set_position(30, 230)
patch.place("comment === GAIN CONTROL ===", verbose=False)[0]

patch.set_position(30, 260)
gain = patch.place("*~ 0.5", verbose=False)[0]           # attenuate to safe level

# === OUTPUT ===
patch.set_position(30, 330)
patch.place("comment === OUTPUT ===", verbose=False)[0]

patch.set_position(30, 360)
dac = patch.place("ezdac~", verbose=False)[0]

# === CONNECTIONS ===
patch.connect(
    [noise.outs[0],  gen_obj.ins[0]], # white noise → gen~ audio inlet
    [gen_obj.outs[0], gain.ins[0]],  # filtered signal → attenuator
    [gain.outs[0],   dac.ins[0]],    # attenuated → left speaker
    [gain.outs[0],   dac.ins[1]],    # attenuated → right speaker
    verbose=False,
)

# === SAVE ===
patch.save("gen_onepole_filter.maxpat")
