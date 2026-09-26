"""
Gen~ FM Synthesis Example
==========================
Two-operator frequency modulation (FM) synthesis built inside gen~.
A modulator oscillator varies the instantaneous frequency of a carrier
oscillator, producing sidebands and timbral richness from just three
parameters: carrier frequency, modulator frequency, and modulation depth.

FM formula:
    modulator  = sin(2π * mod_freq * t)
    inst_freq  = carrier_freq + modulator * mod_depth
    output     = sin(2π * inst_freq * t)   (via phasor + cycle)

Signal chain (gen~ interior):
    param mod_freq 220 → phasor → cycle (modulator sine)
                                      │
                              * mod_depth (scale modulation)
                                      │
    param carrier_freq 440 ──────► + (instantaneous frequency)
                                      │
                              phasor (carrier ramp at inst_freq)
                                      │
                              cycle (carrier sine)
                                      │
                              out 1

Signal chain (outer patch):
    gen~ → *~ 0.3 → ezdac~

Usage:
    python main.py
    → Generates gen_fm_synthesis.maxpat
    → Open in Max/MSP and click the ezdac~ to hear FM synthesis
    → Adjust carrier_freq, mod_freq, and mod_depth params to explore timbres
    → Integer ratios of mod_freq/carrier_freq produce harmonic spectra
    → Non-integer ratios produce inharmonic, bell-like sounds
"""

import maxpylang as mp

# =====================================================================
# GEN~ INTERIOR: two-operator FM synthesizer
# =====================================================================
gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)

# --- PARAMETERS ---
gen_patch.set_position(80, 50)
gen_patch.place("comment --- PARAMETERS ---", verbose=False)[0]

gen_patch.set_position(80, 80)
carrier_freq = gen_patch.place("param carrier_freq 440", verbose=False)[0]

gen_patch.set_position(300, 80)
mod_freq = gen_patch.place("param mod_freq 220", verbose=False)[0]

gen_patch.set_position(520, 80)
mod_depth = gen_patch.place("param mod_depth 200", verbose=False)[0]

# --- MODULATOR OSCILLATOR ---
gen_patch.set_position(300, 180)
gen_patch.place("comment --- MODULATOR OSCILLATOR ---", verbose=False)[0]

# phasor1 generates the modulator ramp at mod_freq
gen_patch.set_position(300, 210)
ph1 = gen_patch.place("phasor", verbose=False)[0]

# cycle1 converts the ramp to a sine wave (the modulator)
gen_patch.set_position(300, 280)
cyc1 = gen_patch.place("cycle", verbose=False)[0]

# Scale modulator sine by mod_depth to get Hz deviation
gen_patch.set_position(300, 350)
mul = gen_patch.place("*", verbose=False)[0]

# --- CARRIER OSCILLATOR ---
gen_patch.set_position(80, 430)
gen_patch.place("comment --- CARRIER OSCILLATOR ---", verbose=False)[0]

# Add modulation to carrier frequency to get instantaneous frequency
gen_patch.set_position(80, 460)
add = gen_patch.place("+", verbose=False)[0]

# phasor2 tracks the instantaneous (modulated) frequency
gen_patch.set_position(80, 530)
ph2 = gen_patch.place("phasor", verbose=False)[0]

# cycle2 converts the carrier ramp to the output sine wave
gen_patch.set_position(80, 600)
cyc2 = gen_patch.place("cycle", verbose=False)[0]

# --- OUTPUT ---
gen_patch.set_position(80, 680)
gen_patch.place("comment --- OUTPUT ---", verbose=False)[0]

gen_patch.set_position(80, 710)
gen_out = gen_patch.place("out 1", verbose=False)[0]

# Wire modulator: mod_freq → phasor1 → cycle1 → * mod_depth
gen_patch.connect(
    [mod_freq.outs[0], ph1.ins[0]],    # mod frequency → phasor1
    [ph1.outs[0],      cyc1.ins[0]],   # phasor1 ramp → cycle1 phase
    [cyc1.outs[0],     mul.ins[0]],    # modulator sine → multiply left
    [mod_depth.outs[0], mul.ins[1]],   # mod depth (Hz) → multiply right
    verbose=False,
)

# Wire carrier: (carrier_freq + modulation) → phasor2 → cycle2 → out
gen_patch.connect(
    [carrier_freq.outs[0], add.ins[0]], # carrier base freq → add left
    [mul.outs[0],          add.ins[1]], # Hz deviation → add right
    [add.outs[0],          ph2.ins[0]], # instantaneous freq → phasor2
    [ph2.outs[0],          cyc2.ins[0]], # carrier ramp → cycle2 phase
    [cyc2.outs[0],         gen_out.ins[0]], # carrier sine → gen outlet
    verbose=False,
)

# =====================================================================
# OUTER PATCH
# =====================================================================
patch = mp.MaxPatch(verbose=False)

# === GEN~ FM SYNTHESIZER ===
patch.set_position(30, 30)
patch.place("comment === GEN~ FM SYNTHESIZER ===", verbose=False)[0]

patch.set_position(30, 60)
gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]

# === GAIN CONTROL ===
patch.set_position(30, 130)
patch.place("comment === GAIN CONTROL ===", verbose=False)[0]

patch.set_position(30, 160)
gain = patch.place("*~ 0.3", verbose=False)[0]           # attenuate to safe level

# === OUTPUT ===
patch.set_position(30, 230)
patch.place("comment === OUTPUT ===", verbose=False)[0]

patch.set_position(30, 260)
dac = patch.place("ezdac~", verbose=False)[0]

# === CONNECTIONS ===
patch.connect(
    [gen_obj.outs[0], gain.ins[0]],   # FM output → attenuator
    [gain.outs[0],    dac.ins[0]],    # attenuated → left speaker
    [gain.outs[0],    dac.ins[1]],    # attenuated → right speaker
    verbose=False,
)

# === SAVE ===
patch.save("gen_fm_synthesis.maxpat")
