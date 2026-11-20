"""Plucking a chord
mc.line~ with 2 channels gives each voice its own copy of a ramp. The list "1 10 0 400" goes to both: up in 10 ms, down over 400 ms, so a two-note chord plucks every 600 ms.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_line_tilde, metro

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 440 554")[0]   # 2 channels
two = patch.place("message chans 2, 0")[0]  # 2 channels, both starting at 0
clock = patch.place(metro(600, active=1))[0]
shape = patch.place("message 1 10 0 400")[0]   # pairs: target, time in ms
env = patch.place(mc_line_tilde)[0]
osc = patch.place(mc_cycle_tilde(440))[0]
amp = patch.place("mc.*~ 0.")[0]            # channel by channel: tone times envelope
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (start.outs[0], two.ins[0]),
    (voices.outs[0], osc.ins[0]),
    (two.outs[0], env.ins[0]),
    (clock.outs[0], shape.ins[0]),
    (shape.outs[0], env.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_line")
