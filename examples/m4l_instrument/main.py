"""
Max for Live Instrument Example
================================
A minimal sine synth that runs as a Max for Live MIDI instrument in Ableton.

Signal chain:
    notein → mtof → cycle~ → clip~ -1. 1. → plugout~ (stereo)

Usage:
    python main.py
    → Generates m4l_instrument.amxd
    → Drag onto a MIDI track in Ableton Live
"""

import maxpylang as mp

patch = mp.MaxPatch()

# === MIDI INPUT ===
patch.set_position(30, 30)
patch.place("comment === MIDI INPUT ===")[0]

patch.set_position(30, 60)
notein = patch.place("notein")[0]

patch.set_position(30, 100)
mtof = patch.place("mtof")[0]

# === OSCILLATOR ===
patch.set_position(30, 160)
patch.place("comment === OSCILLATOR ===")[0]

patch.set_position(30, 190)
osc = patch.place("cycle~")[0]

# === OUTPUT ===
patch.set_position(30, 250)
patch.place("comment === OUTPUT ===")[0]

patch.set_position(30, 280)
clip = patch.place("clip~ -1. 1.")[0]

patch.set_position(30, 320)
plugout = patch.place("plugout~")[0]

# === CONNECTIONS ===
patch.connect(
    [notein.outs[0], mtof.ins[0]],      # note number → mtof
    [mtof.outs[0], osc.ins[0]],          # frequency → oscillator
    [osc.outs[0], clip.ins[0]],          # audio → safety limiter
    [clip.outs[0], plugout.ins[0]],      # left channel → Ableton
    [clip.outs[0], plugout.ins[1]],      # right channel → Ableton
)

# === SAVE ===
# device_type="instrument" is the explicit flag for M4L instruments
patch.save("m4l_instrument.amxd", device_type="instrument")
