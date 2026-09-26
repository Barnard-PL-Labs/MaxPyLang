"""
Gen~ Ramp-to-Click Example
============================
Generates rhythmic audio clicks by detecting the discontinuity in a
phasor's sawtooth waveform. When a phasor resets from ~1 back to 0,
the delta (sample-to-sample difference) produces a large negative spike.
Taking the absolute value and thresholding it yields a clean click pulse.

This technique is widely used for metronomes, click tracks, and
synchronizing processes to a phasor's cycle rate.

Signal chain (gen~ interior):
    param rate 2 → phasor → delta → abs → > 0.5 → out 1

Signal chain (outer patch):
    gen~ → *~ 0.5 → ezdac~

Usage:
    python main.py
    → Generates gen_ramp_to_click.maxpat
    → Open in Max/MSP; you will hear clicks at 2 Hz (2 clicks per second)
    → Change param rate to adjust click frequency
"""

import maxpylang as mp

# =====================================================================
# GEN~ INTERIOR: phasor discontinuity → click pulse
# =====================================================================
gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)

# param rate sets the phasor frequency in Hz (default: 2 clicks/sec)
gen_patch.set_position(100, 50)
rate_param = gen_patch.place("param rate 2", verbose=False)[0]

# phasor outputs a 0→1 sawtooth at the given rate
# At each cycle wrap, it jumps from ~1.0 back to 0 in one sample
gen_patch.set_position(100, 120)
ph = gen_patch.place("phasor", verbose=False)[0]

# delta computes the difference between consecutive samples
# The wrap-around produces a large negative spike (~-1.0)
gen_patch.set_position(100, 190)
dlt = gen_patch.place("delta", verbose=False)[0]

# abs makes the negative spike positive (~1.0), normal steps stay near 0
gen_patch.set_position(100, 260)
ab = gen_patch.place("abs", verbose=False)[0]

# > 0.5 outputs 1 only when the absolute delta exceeds 0.5
# This fires exactly once per phasor cycle (at the discontinuity)
gen_patch.set_position(100, 330)
thresh = gen_patch.place("> 0.5", verbose=False)[0]

# Output the 0/1 click pulse
gen_patch.set_position(100, 400)
gen_out = gen_patch.place("out 1", verbose=False)[0]

# Wire: param rate → phasor → delta → abs → > 0.5 → out 1
gen_patch.connect(
    [rate_param.outs[0], ph.ins[0]],     # rate → phasor frequency
    [ph.outs[0],         dlt.ins[0]],    # phasor → delta detector
    [dlt.outs[0],        ab.ins[0]],     # delta → absolute value
    [ab.outs[0],         thresh.ins[0]], # abs delta → threshold comparator
    [thresh.outs[0],     gen_out.ins[0]], # pulse → output
    verbose=False,
)

# =====================================================================
# OUTER PATCH
# =====================================================================
patch = mp.MaxPatch(verbose=False)

# === GEN~ CLICK GENERATOR ===
patch.set_position(30, 30)
patch.place("comment === GEN~ CLICK GENERATOR ===", verbose=False)[0]

patch.set_position(30, 60)
gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]

# === GAIN CONTROL ===
patch.set_position(30, 130)
patch.place("comment === GAIN CONTROL ===", verbose=False)[0]

patch.set_position(30, 160)
# Scale the 0/1 click pulse to a safe amplitude
gain = patch.place("*~ 0.5", verbose=False)[0]

# === OUTPUT ===
patch.set_position(30, 230)
patch.place("comment === OUTPUT ===", verbose=False)[0]

patch.set_position(30, 260)
dac = patch.place("ezdac~", verbose=False)[0]

# === CONNECTIONS ===
patch.connect(
    [gen_obj.outs[0], gain.ins[0]],    # click pulse → gain attenuator
    [gain.outs[0],    dac.ins[0]],     # attenuated click → left speaker
    [gain.outs[0],    dac.ins[1]],     # attenuated click → right speaker
    verbose=False,
)

# === SAVE ===
patch.save("gen_ramp_to_click.maxpat")
