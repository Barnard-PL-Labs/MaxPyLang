"""A random rhythm
equals is the long name of ==. random picks 0..3 on every tick, and equals 2 outputs 1 only when it picks 2; as the volume of *~, that lets through about one tick in four.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, random

patch = mp.MaxPatch()
clock = patch.place(metro(125, active=1))[0]
pick = patch.place(random(4))[0]
hit = patch.place("equals 2")[0]
osc = patch.place(cycle_tilde(440))[0]
gate = patch.place("*~ 0.")[0]       # 1 lets the tone through, 0 silences it
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], pick.ins[0]),
    (pick.outs[0], hit.ins[0]),
    (hit.outs[0], gate.ins[1]),
    (osc.outs[0], gate.ins[0]),
    (gate.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("equals")
