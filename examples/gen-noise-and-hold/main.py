"""
Gen~ Noise-and-Hold Example
============================
A sample-and-hold random pitch generator. White noise is sampled at a
rate set by a param, producing stepped random voltages that drive a
sine oscillator at a random pitch. Demonstrates noise, phasor-based
triggering, and sah (sample-and-hold) inside gen~.

Signal chain (gen~ interior):
    noise → sah (signal input)
    param rate 4 → phasor → delta → abs → > 0.5 → sah (trigger input)
    sah → * 1000 → + 200 → out 1

Signal chain (outer patch):
    gen~ → cycle~ → *~ 0.2 → ezdac~
    (gen~ output is used as frequency for cycle~)

Usage:
    python main.py
    → Generates gen_noise_and_hold.maxpat
    → Open in Max/MSP and click the ezdac~ to hear random pitch steps
    → Increase the rate param to speed up the stepping
"""

import maxpylang as mp

# =====================================================================
# GEN~ INTERIOR: sample-and-hold random pitch generator
# =====================================================================
gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)

# --- NOISE SOURCE ---
gen_patch.set_position(80, 50)
gen_patch.place("comment --- NOISE SOURCE ---", verbose=False)[0]

gen_patch.set_position(80, 80)
noise = gen_patch.place("noise", verbose=False)[0]       # white noise: output -1 to 1

# --- TRIGGER CHAIN ---
gen_patch.set_position(300, 50)
gen_patch.place("comment --- TRIGGER CHAIN ---", verbose=False)[0]

# Rate param controls how many times per second the hold updates
gen_patch.set_position(300, 80)
rate_param = gen_patch.place("param rate 4", verbose=False)[0]   # hold rate in Hz

gen_patch.set_position(300, 150)
ph = gen_patch.place("phasor", verbose=False)[0]         # ramp 0→1 at rate Hz

# delta detects the wrap-around discontinuity in the phasor
gen_patch.set_position(300, 220)
dlt = gen_patch.place("delta", verbose=False)[0]         # sample-to-sample difference

# abs to get magnitude of the negative jump at the wrap
gen_patch.set_position(300, 290)
abso = gen_patch.place("abs", verbose=False)[0]          # magnitude of delta

# threshold: wrap produces a large negative delta, abs makes it large positive
gen_patch.set_position(300, 360)
thresh = gen_patch.place("> 0.5", verbose=False)[0]      # 1 when wrap occurs, else 0

# --- SAMPLE AND HOLD ---
gen_patch.set_position(80, 360)
gen_patch.place("comment --- SAMPLE AND HOLD ---", verbose=False)[0]

gen_patch.set_position(80, 390)
sah = gen_patch.place("sah", verbose=False)[0]           # sah: holds input when triggered
sah.add_xlets(1, 'numinlets')                            # sah needs 2 inlets: signal and trigger

# --- SCALING ---
gen_patch.set_position(80, 460)
gen_patch.place("comment --- SCALING ---", verbose=False)[0]

gen_patch.set_position(80, 490)
scale = gen_patch.place("* 500", verbose=False)[0]       # scale noise (-1..1) to (-500..500)

gen_patch.set_position(80, 560)
offset = gen_patch.place("+ 700", verbose=False)[0]      # shift to (200..1200 Hz)

# Output port
gen_patch.set_position(80, 630)
gen_out = gen_patch.place("out 1", verbose=False)[0]

# Wire trigger chain: rate_param → phasor → delta → abs → > 0.5
gen_patch.connect(
    [rate_param.outs[0], ph.ins[0]],     # rate → phasor frequency
    [ph.outs[0],         dlt.ins[0]],    # phasor ramp → delta
    [dlt.outs[0],        abso.ins[0]],   # delta → abs
    [abso.outs[0],       thresh.ins[0]], # abs → threshold comparator
    verbose=False,
)

# Wire sah: noise → sah signal input, trigger → sah trigger input
gen_patch.connect(
    [noise.outs[0],  sah.ins[0]],    # noise → sah signal
    [thresh.outs[0], sah.ins[1]],    # trigger pulse → sah trigger
    verbose=False,
)

# Wire scaling: sah → * 500 → + 700 → out
gen_patch.connect(
    [sah.outs[0],    scale.ins[0]],   # held noise → scale
    [scale.outs[0],  offset.ins[0]],  # scaled → offset
    [offset.outs[0], gen_out.ins[0]], # frequency value → gen outlet
    verbose=False,
)

# =====================================================================
# OUTER PATCH: gen~ output drives a cycle~ oscillator
# =====================================================================
patch = mp.MaxPatch(verbose=False)

# === GEN~ PITCH GENERATOR ===
patch.set_position(30, 30)
patch.place("comment === GEN~ PITCH GENERATOR ===", verbose=False)[0]

patch.set_position(30, 60)
gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]

# === OSCILLATOR ===
patch.set_position(30, 130)
patch.place("comment === OSCILLATOR ===", verbose=False)[0]

patch.set_position(30, 160)
# cycle~ uses the stepped frequency from gen~ to produce the tone
osc = patch.place("cycle~", verbose=False)[0]

# === GAIN CONTROL ===
patch.set_position(30, 230)
patch.place("comment === GAIN CONTROL ===", verbose=False)[0]

patch.set_position(30, 260)
gain = patch.place("*~ 0.2", verbose=False)[0]           # gentle listening level

# === OUTPUT ===
patch.set_position(30, 330)
patch.place("comment === OUTPUT ===", verbose=False)[0]

patch.set_position(30, 360)
dac = patch.place("ezdac~", verbose=False)[0]

# === CONNECTIONS ===
patch.connect(
    [gen_obj.outs[0], osc.ins[0]],   # gen~ frequency → cycle~ frequency inlet
    [osc.outs[0],     gain.ins[0]],  # oscillator → attenuator
    [gain.outs[0],    dac.ins[0]],   # attenuated → left speaker
    [gain.outs[0],    dac.ins[1]],   # attenuated → right speaker
    verbose=False,
)

# === SAVE ===
patch.save("gen_noise_and_hold.maxpat")
