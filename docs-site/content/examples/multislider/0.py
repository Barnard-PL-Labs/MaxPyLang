"""A volume fader
multislider is a row of sliders that sends all their values as a list; this one has a single slider, set to 0..1. It sets the volume of cycle~ through *~. Press ▶, then drag the multislider to the bottom to silence the tone and to the top for full volume.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde

patch = mp.MaxPatch()
fader = patch.place(mp.MaxObject("multislider", setminmax=[0., 1.]))[0]   # Max's default is -1..1
osc = patch.place(cycle_tilde(330))[0]
level = patch.place("*~ 0.5")[0]           # half volume until you move it
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (fader.outs[0], level.ins[1]),
    (osc.outs[0], level.ins[0]),
    (level.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("multislider")
