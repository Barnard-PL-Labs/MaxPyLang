"""
Max for Live Audio Effect Example
===================================
A simple lowpass filter that runs as a Max for Live audio effect in Ableton.

Signal chain:
    plugin~ (stereo from track) → lores~ (lowpass filter) → clip~ → plugout~ (stereo)

Usage:
    python main.py
    → Generates m4l_audio_effect.amxd
    → Drag onto an audio track (or after an instrument) in Ableton Live
"""

import maxpylang as mp

patch = mp.MaxPatch()

# === AUDIO INPUT ===
patch.set_position(30, 30)
patch.place("comment === AUDIO INPUT ===")[0]

patch.set_position(30, 60)
plugin = patch.place("plugin~")[0]  # stereo audio from track

# === FILTER ===
patch.set_position(30, 120)
patch.place("comment === FILTER ===")[0]

# Left channel filter
patch.set_position(30, 150)
filt_l = patch.place("lores~ 2000 0.5")[0]

# Right channel filter
patch.set_position(200, 150)
filt_r = patch.place("lores~ 2000 0.5")[0]

# === OUTPUT ===
patch.set_position(30, 220)
patch.place("comment === OUTPUT ===")[0]

patch.set_position(30, 250)
clip_l = patch.place("clip~ -1. 1.")[0]

patch.set_position(200, 250)
clip_r = patch.place("clip~ -1. 1.")[0]

patch.set_position(30, 290)
plugout = patch.place("plugout~")[0]

# === CONNECTIONS ===
patch.connect(
    # plugin~ stereo → filters
    [plugin.outs[0], filt_l.ins[0]],     # left in → left filter
    [plugin.outs[1], filt_r.ins[0]],     # right in → right filter
    # filters → safety limiters
    [filt_l.outs[0], clip_l.ins[0]],
    [filt_r.outs[0], clip_r.ins[0]],
    # limiters → plugout~ stereo
    [clip_l.outs[0], plugout.ins[0]],    # left → Ableton
    [clip_r.outs[0], plugout.ins[1]],    # right → Ableton
)

# === SAVE ===
# device_type="audio_effect" is the explicit flag for M4L audio effects
patch.save("m4l_audio_effect.amxd", device_type="audio_effect")
