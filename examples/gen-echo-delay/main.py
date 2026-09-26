"""
Gen~ Echo Delay Example
=========================
A feedback echo effect built inside gen~. The input signal is summed
with a delayed, attenuated copy of itself. The delay buffer holds up
to one second of audio; delaytime and feedback are exposed as params
so they can be adjusted from the outer patch without recompiling.

Delay formula (per sample):
    summed  = in[n] + delayed[n] * feedback
    delay   ← summed                        (write new sample)
    out[n]  = summed

Signal chain (gen~ interior):
    param feedback 0.5 ──────────────────────────┐
                                                  ▼
    in 1 ──► + (summed) ──► delay 44100 ──► * (feedback) ──► (back to +)
                │            ▲
                │            └── param delaytime 10000
                ▼
              out 1

Signal chain (outer patch):
    cycle~ 440 → *~ 0.3 → gen~ → ezdac~

Usage:
    python main.py
    → Generates gen_echo_delay.maxpat
    → Open in Max/MSP and click the ezdac~ to hear a repeating echo
    → Adjust delaytime param to change echo spacing
    → Adjust feedback param (keep < 1.0) to change echo decay
"""

import maxpylang as mp

# =====================================================================
# GEN~ INTERIOR: feedback echo delay
# =====================================================================
gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)

# --- INPUTS AND PARAMS ---
gen_patch.set_position(80, 50)
gen_patch.place("comment --- INPUTS AND PARAMS ---", verbose=False)[0]

gen_patch.set_position(80, 80)
gen_in = gen_patch.place("in 1", verbose=False)[0]       # audio inlet

# delaytime in samples (~227 ms at 44100 Hz)
gen_patch.set_position(300, 80)
delaytime_param = gen_patch.place("param delaytime 10000", verbose=False)[0]

# feedback coefficient: how much of the delayed signal recirculates
gen_patch.set_position(500, 80)
feedback_param = gen_patch.place("param feedback 0.5", verbose=False)[0]

# --- FEEDBACK LOOP ---
gen_patch.set_position(80, 180)
gen_patch.place("comment --- FEEDBACK LOOP ---", verbose=False)[0]

# Summing junction: input + feedback signal
gen_patch.set_position(80, 210)
add = gen_patch.place("+", verbose=False)[0]

# Delay line: 44100-sample buffer (1 second max at 44100 Hz)
gen_patch.set_position(80, 290)
dly = gen_patch.place("delay 44100", verbose=False)[0]

# Attenuate the delayed signal before feeding back
gen_patch.set_position(80, 370)
mul = gen_patch.place("*", verbose=False)[0]

# --- OUTPUT ---
gen_patch.set_position(80, 460)
gen_patch.place("comment --- OUTPUT ---", verbose=False)[0]

gen_patch.set_position(80, 490)
gen_out = gen_patch.place("out 1", verbose=False)[0]

# Wire summing junction: in + feedback
gen_patch.connect(
    [gen_in.outs[0], add.ins[0]],    # audio input → add left inlet
    [mul.outs[0],    add.ins[1]],    # attenuated delayed signal → add right inlet
    verbose=False,
)

# Wire delay: summed signal in, delaytime sets the read position
gen_patch.connect(
    [add.outs[0],          dly.ins[0]],  # summed → delay write inlet
    [delaytime_param.outs[0], dly.ins[1]], # delaytime → delay tap position
    verbose=False,
)

# Wire feedback attenuation: delay output * feedback coefficient
gen_patch.connect(
    [dly.outs[0],          mul.ins[0]],  # delayed signal → multiply left inlet
    [feedback_param.outs[0], mul.ins[1]], # feedback coeff → multiply right inlet
    verbose=False,
)

# Send summed signal (wet+dry) to output
gen_patch.connect(
    [add.outs[0], gen_out.ins[0]],   # summed signal → gen outlet
    verbose=False,
)

# =====================================================================
# OUTER PATCH: apply echo to a test tone
# =====================================================================
patch = mp.MaxPatch(verbose=False)

# === SIGNAL SOURCE ===
patch.set_position(30, 30)
patch.place("comment === SIGNAL SOURCE ===", verbose=False)[0]

patch.set_position(30, 60)
osc = patch.place("cycle~ 440", verbose=False)[0]        # 440 Hz test tone

# === GAIN TRIM ===
patch.set_position(30, 130)
patch.place("comment === GAIN TRIM ===", verbose=False)[0]

patch.set_position(30, 160)
# Trim before the delay so the buffer doesn't clip
trim = patch.place("*~ 0.3", verbose=False)[0]

# === GEN~ ECHO ===
patch.set_position(30, 230)
patch.place("comment === GEN~ ECHO ===", verbose=False)[0]

patch.set_position(30, 260)
gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]

# === OUTPUT ===
patch.set_position(30, 330)
patch.place("comment === OUTPUT ===", verbose=False)[0]

patch.set_position(30, 360)
dac = patch.place("ezdac~", verbose=False)[0]

# === CONNECTIONS ===
patch.connect(
    [osc.outs[0],     trim.ins[0]],     # oscillator → gain trim
    [trim.outs[0],    gen_obj.ins[0]],  # trimmed signal → gen~ inlet
    [gen_obj.outs[0], dac.ins[0]],      # echo output → left speaker
    [gen_obj.outs[0], dac.ins[1]],      # echo output → right speaker
    verbose=False,
)

# === SAVE ===
patch.save("gen_echo_delay.maxpat")
