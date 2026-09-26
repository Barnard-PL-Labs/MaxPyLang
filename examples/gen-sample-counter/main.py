"""
Gen~ Sample Counter Example
============================
Demonstrates the fundamental accumulator pattern inside gen~: using a
history object to feed the previous sample's value back into an adder.
Each time a non-zero signal arrives, the running total increments.

This is the building block for many gen~ algorithms — any time you need
to "remember" a value across samples, history is the tool.

Signal chain (gen~ interior):
    in 1 ──→ + ──→ out 1
              ↑       │
           history ←──┘  (feedback: previous output feeds back into adder)

Signal chain (outer patch):
    sig~ 1 → gen~ → number~

Usage:
    python main.py
    → Generates gen_sample_counter.maxpat
    → Open in Max/MSP; number~ will display a steadily climbing sample count
    → Replace sig~ 1 with sig~ 0 to pause the counter
"""

import maxpylang as mp

# =====================================================================
# GEN~ INTERIOR: accumulator using history feedback
# =====================================================================
gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)

# in 1 provides the per-sample increment value (e.g. 1 = count every sample)
gen_patch.set_position(60, 50)
gen_in = gen_patch.place("in 1", verbose=False)[0]

# + adds the current increment to the stored previous total
gen_patch.set_position(160, 130)
adder = gen_patch.place("+", verbose=False)[0]

# history stores one sample of state — the previous output of the adder
# On the very first sample, history outputs 0 (its initial value)
gen_patch.set_position(280, 130)
hist = gen_patch.place("history", verbose=False)[0]

# out 1 sends the running total to the outer patch
gen_patch.set_position(160, 220)
gen_out = gen_patch.place("out 1", verbose=False)[0]

# Wire the accumulator loop:
#   in 1 → left inlet of +       (new increment each sample)
#   history → right inlet of +   (previously accumulated total)
#   + → history                  (store this sample's total for next sample)
#   + → out 1                    (also send the total downstream)
gen_patch.connect(
    [gen_in.outs[0], adder.ins[0]],   # increment → adder left inlet
    [hist.outs[0],   adder.ins[1]],   # previous total → adder right inlet
    [adder.outs[0],  hist.ins[0]],    # new total → history (feedback)
    [adder.outs[0],  gen_out.ins[0]], # new total → output
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
# sig~ 1 sends a constant 1.0 every sample — counter increments by 1 each sample
sig = patch.place("sig~ 1", verbose=False)[0]

# === GEN~ COUNTER ===
patch.set_position(30, 130)
patch.place("comment === GEN~ COUNTER ===", verbose=False)[0]

patch.set_position(30, 160)
gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]

# === DISPLAY ===
patch.set_position(30, 230)
patch.place("comment === DISPLAY ===", verbose=False)[0]

patch.set_position(30, 260)
# number~ displays a signal value updated once per vector
num = patch.place("number~", verbose=False)[0]

# === CONNECTIONS ===
patch.connect(
    [sig.outs[0],     gen_obj.ins[0]],  # constant 1 → gen~ (increment each sample)
    [gen_obj.outs[0], num.ins[0]],      # running total → number~ display
    verbose=False,
)

# === SAVE ===
patch.save("gen_sample_counter.maxpat")
