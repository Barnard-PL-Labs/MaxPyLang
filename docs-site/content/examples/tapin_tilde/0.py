"""Echoes that fade: tapin~ and tapout~
tapin~ records into a delay line and tapout~ reads it back 300 ms later. Feeding half the echo back in makes it repeat, quieter each time.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, line_tilde, metro, tapin_tilde, tapout_tilde

patch = mp.MaxPatch()
clock = patch.place(metro(2000, active=1))[0]
shape = patch.place("message 1 5 0 120")[0]
env = patch.place(line_tilde)[0]
osc = patch.place(cycle_tilde(523))[0]
amp = patch.place("*~ 0.")[0]              # times the envelope (silent until it rises)
mix = patch.place("+~")[0]
rec = patch.place(tapin_tilde(1000))[0]      # holds up to 1000 ms
tap = patch.place(tapout_tilde(300))[0]      # reads 300 ms back
fade = patch.place("*~ 0.5")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], shape.ins[0]),
    (shape.outs[0], env.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),
    (amp.outs[0], mix.ins[0]),
    (mix.outs[0], rec.ins[0]),
    (rec.outs[0], tap.ins[0]),         # tapin~ always connects to tapout~
    (tap.outs[0], fade.ins[0]),
    (fade.outs[0], mix.ins[1]),        # feedback: the echo goes round again
    (mix.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("taps")
