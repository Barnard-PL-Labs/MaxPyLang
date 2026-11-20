"""Two outlets: a stereo abstraction
Each outlet object in an abstraction becomes an outlet on its box, left to right. This script places detune in a main patch, then builds detune.maxpat: one pitch comes in, and two sines 2 Hz apart come out, one for each speaker, so the sound beats slowly.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, inlet, loadmess, outlet

# The main patch. detune's file is built below, so declare its ports here.
patch = mp.MaxPatch()
pitch = patch.place(loadmess(220))[0]
pair = patch.place(mp.MaxObject("detune", abstraction=True, inlets=1, outlets=2))[0]
left = patch.place("*~ 0.2")[0]
right = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]
patch.connect(
    (pitch.outs[0], pair.ins[0]),
    (pair.outs[0], left.ins[0]),
    (pair.outs[1], right.ins[0]),
    (left.outs[0], out.ins[0]),
    (right.outs[0], out.ins[1]),
)
patch.save("main")

# detune.maxpat, saved next to main.maxpat. Its outlets are the box's outlets.
inner = mp.MaxPatch()
hz = inner.place(inlet)[0]
up = inner.place("+ 2")[0]
osc_l = inner.place(cycle_tilde(0))[0]
osc_r = inner.place(cycle_tilde(0))[0]
out_l = inner.place(outlet)[0]                 # left outlet
out_r = inner.place(outlet)[0]                 # right outlet
inner.connect(
    (hz.outs[0], osc_l.ins[0]),
    (hz.outs[0], up.ins[0]),
    (up.outs[0], osc_r.ins[0]),
    (osc_l.outs[0], out_l.ins[0]),
    (osc_r.outs[0], out_r.ins[0]),
)
inner.save("detune")
