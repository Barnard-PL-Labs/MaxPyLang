"""
Gen~ Wavetable Oscillator Example
===================================
A wavetable oscillator that reads a named buffer at audio rate inside
gen~. A phasor generates a 0→1 ramp at the desired frequency; peek
uses that ramp as a normalized read position into the buffer, allowing
any waveform stored in a Max buffer~ to be played back as an oscillator.

Signal chain (gen~ interior):
    param freq 110 → phasor → peek mytable → out 1
    buffer mytable  (declares the buffer reference for peek)

Signal chain (outer patch):
    buffer~ mytable (holds the actual waveform data)
    gen~ → *~ 0.3 → ezdac~

Usage:
    python main.py
    → Generates gen_wavetable_osc.maxpat
    → Open in Max/MSP: the buffer~ mytable is created automatically
    → Fill mytable with a waveform (e.g. send it a 'sinesf 1' message)
    → Click the ezdac~ to hear the wavetable oscillator at 110 Hz
    → Send a float to gen~'s freq param to change pitch
"""

import maxpylang as mp

# =====================================================================
# GEN~ INTERIOR: wavetable oscillator
# =====================================================================
gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)

# --- PARAMETERS ---
gen_patch.set_position(80, 50)
gen_patch.place("comment --- PARAMETERS ---", verbose=False)[0]

# Frequency param: controls oscillator pitch
gen_patch.set_position(80, 80)
freq_param = gen_patch.place("param freq 110", verbose=False)[0]

# Declare the buffer reference — must match the outer buffer~ name
gen_patch.set_position(300, 80)
# buffer declares the buffer reference inside gen~.
# peek finds it by matching names — no patchcord connection needed.
gen_patch.place("buffer mytable", verbose=False)[0]

# --- OSCILLATOR ---
gen_patch.set_position(80, 180)
gen_patch.place("comment --- OSCILLATOR ---", verbose=False)[0]

# phasor generates a normalized 0→1 ramp at the given frequency
gen_patch.set_position(80, 210)
ph = gen_patch.place("phasor", verbose=False)[0]

# peek mytable reads the named buffer at the phasor's 0→1 position
# The buffer name in the argument links peek to the buffer declaration above
gen_patch.set_position(80, 290)
pk = gen_patch.place("peek mytable", verbose=False)[0]

# --- OUTPUT ---
gen_patch.set_position(80, 380)
gen_patch.place("comment --- OUTPUT ---", verbose=False)[0]

gen_patch.set_position(80, 410)
gen_out = gen_patch.place("out 1", verbose=False)[0]

# Wire: freq → phasor (ramp rate), phasor ramp → peek position → out
# peek finds the buffer by the name in its argument — no extra connection needed
gen_patch.connect(
    [freq_param.outs[0], ph.ins[0]],      # frequency → phasor rate
    [ph.outs[0],         pk.ins[0]],      # 0→1 ramp → peek read position
    [pk.outs[0],         gen_out.ins[0]], # sample value → gen outlet
    verbose=False,
)

# =====================================================================
# OUTER PATCH: host the wavetable oscillator
# =====================================================================
patch = mp.MaxPatch(verbose=False)

# === WAVETABLE BUFFER ===
patch.set_position(30, 30)
patch.place("comment === WAVETABLE BUFFER ===", verbose=False)[0]

patch.set_position(30, 60)
# buffer~ holds the waveform data; name must match the gen~ buffer declaration
buf_obj = patch.place("buffer~ mytable", verbose=False)[0]

# === GEN~ OSCILLATOR ===
patch.set_position(30, 130)
patch.place("comment === GEN~ OSCILLATOR ===", verbose=False)[0]

patch.set_position(30, 160)
gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]

# === GAIN CONTROL ===
patch.set_position(30, 230)
patch.place("comment === GAIN CONTROL ===", verbose=False)[0]

patch.set_position(30, 260)
gain = patch.place("*~ 0.3", verbose=False)[0]           # attenuate to safe level

# === OUTPUT ===
patch.set_position(30, 330)
patch.place("comment === OUTPUT ===", verbose=False)[0]

patch.set_position(30, 360)
dac = patch.place("ezdac~", verbose=False)[0]

# === CONNECTIONS ===
# Note: buffer~ has no audio connection — gen~ finds it by name
patch.connect(
    [gen_obj.outs[0], gain.ins[0]],   # wavetable oscillator → attenuator
    [gain.outs[0],    dac.ins[0]],    # attenuated → left speaker
    [gain.outs[0],    dac.ins[1]],    # attenuated → right speaker
    verbose=False,
)

# === SAVE ===
patch.save("gen_wavetable_osc.maxpat")
