"""
Gen~ Bounded Ramp Example
==========================
A manual phasor implemented using history + wrap feedback. Each sample,
a small rate value is added to the previous ramp position, and wrap
keeps the output in the [0, 1) range — creating a continuously cycling
sawtooth waveform.

This is the "manual phasor" pattern, useful for understanding how
gen~'s built-in phasor actually works under the hood.

Signal chain (gen~ interior):
    param rate 0.001 ──→ + ──→ wrap 0 1 ──→ out 1
                          ↑          │
                       history ←─────┘  (feedback: wraps back into adder)

Signal chain (outer patch):
    gen~ → scope~

Usage:
    python main.py
    → Generates gen_bounded_ramp.maxpat
    → Open in Max/MSP; scope~ will show a sawtooth wave cycling at ~44 Hz
      (rate 0.001 at 44100 Hz sr = 0.001 * 44100 ≈ 44 cycles/sec)
    → Change param rate to adjust the ramp speed (0.0001 for very slow)
"""

import maxpylang as mp

# =====================================================================
# GEN~ INTERIOR: manual phasor via history + wrap
# =====================================================================
gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)

# param rate sets how much to advance the ramp each sample
# 0.001 at 44100 Hz sr produces ~44 Hz cycling
gen_patch.set_position(60, 50)
rate_param = gen_patch.place("param rate 0.001", verbose=False)[0]

# + adds the rate increment to the previous ramp position
gen_patch.set_position(160, 130)
adder = gen_patch.place("+", verbose=False)[0]

# wrap 0 1 folds the output back into [0, 1) when it reaches or exceeds 1
gen_patch.set_position(160, 210)
wr = gen_patch.place("wrap 0 1", verbose=False)[0]

# history stores the wrapped ramp position from the previous sample
gen_patch.set_position(310, 130)
hist = gen_patch.place("history", verbose=False)[0]

# out 1 sends the current ramp position (0.0 to just below 1.0) out
gen_patch.set_position(160, 300)
gen_out = gen_patch.place("out 1", verbose=False)[0]

# Wire the bounded ramp loop:
#   param rate → left inlet of +     (advance by this amount each sample)
#   history → right inlet of +       (previous ramp position)
#   + → wrap 0 1                     (keep in [0, 1) range)
#   wrap → history                   (store for next sample — feedback)
#   wrap → out 1                     (output the ramp value)
gen_patch.connect(
    [rate_param.outs[0], adder.ins[0]],  # rate increment → adder left
    [hist.outs[0],       adder.ins[1]],  # previous position → adder right
    [adder.outs[0],      wr.ins[0]],     # sum → wrap (boundary check)
    [wr.outs[0],         hist.ins[0]],   # wrapped value → history (feedback)
    [wr.outs[0],         gen_out.ins[0]], # wrapped value → output
    verbose=False,
)

# =====================================================================
# OUTER PATCH
# =====================================================================
patch = mp.MaxPatch(verbose=False)

# === GEN~ RAMP GENERATOR ===
patch.set_position(30, 30)
patch.place("comment === GEN~ RAMP GENERATOR ===", verbose=False)[0]

patch.set_position(30, 60)
gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]

# === VISUALIZER ===
patch.set_position(30, 130)
patch.place("comment === VISUALIZER ===", verbose=False)[0]

patch.set_position(30, 160)
# scope~ shows the repeating sawtooth ramp waveform
scope = patch.place("scope~", verbose=False)[0]

# === CONNECTIONS ===
patch.connect(
    [gen_obj.outs[0], scope.ins[0]],   # ramp signal → oscilloscope
    verbose=False,
)

# === SAVE ===
patch.save("gen_bounded_ramp.maxpat")
