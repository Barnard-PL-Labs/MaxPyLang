"""A plucked note
line~ ramps a signal to a target over a time. The list "1 10 0 400" is two segments: up to 1 in 10 ms, then down to 0 over 400 ms; multiplying by it shapes each note.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, line_tilde, metro

patch = mp.MaxPatch()
clock = patch.place(metro(600, active=1))[0]
shape = patch.place("message 1 10 0 400")[0]   # pairs: target, time in ms
env = patch.place(line_tilde)[0]
osc = patch.place(cycle_tilde(440))[0]
amp = patch.place("*~ 0.")[0]              # times the envelope (silent until it rises)
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], shape.ins[0]),
    (shape.outs[0], env.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),         # the envelope sets the volume
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("pluck")
