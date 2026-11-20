"""A blip that flutters
allpass~ 100 30 0.7 passes every frequency at the same level but feeds its 30 ms delay back on itself, so each short blip trails a quick, fading flutter of echoes.
"""
import maxpylang as mp
from maxpylang.objects import allpass_tilde, cycle_tilde, ezdac_tilde, line_tilde, metro

patch = mp.MaxPatch()
clock = patch.place(metro(1000, active=1))[0]
shape = patch.place("message 1 2 0 40")[0]   # up in 2 ms, down in 40 ms
env = patch.place(line_tilde)[0]
osc = patch.place(cycle_tilde(880))[0]
amp = patch.place("*~ 0.")[0]                # times the envelope
diffuse = patch.place(allpass_tilde(100, 30, 0.7))[0]   # max 100 ms, 30 ms delay, gain 0.7
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], shape.ins[0]),
    (shape.outs[0], env.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),
    (amp.outs[0], diffuse.ins[0]),
    (diffuse.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("allpass_tilde")
