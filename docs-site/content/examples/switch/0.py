"""Listen to one of two melodies
switch passes one of its inlets to its outlet: the left inlet chooses which (1 or 2; 0 shuts it). loadmess picks the climbing scale; the toggle, plus 1, picks it or the random notes. Press ▶, then click the toggle to switch melodies.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, loadmess, metro, mtof, random, switch, toggle

patch = mp.MaxPatch()
start = patch.place(loadmess(1))[0]
flip = patch.place(toggle)[0]
which = patch.place("+ 1")[0]
clock = patch.place(metro(200, active=1))[0]
scale_up = patch.place(counter(60, 72))[0]
wander = patch.place(random(24))[0]
pitch = patch.place("+ 60")[0]
pick = patch.place(switch)[0]          # two inlets to choose from
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], pick.ins[0]), (flip.outs[0], which.ins[0]), (which.outs[0], pick.ins[0]),
    (clock.outs[0], scale_up.ins[0]), (clock.outs[0], wander.ins[0]),
    (wander.outs[0], pitch.ins[0]), (scale_up.outs[0], pick.ins[1]), (pitch.outs[0], pick.ins[2]),
    (pick.outs[0], hz.ins[0]), (hz.outs[0], osc.ins[0]), (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]),
)
patch.save("switch")
