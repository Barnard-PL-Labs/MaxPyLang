"""Switching between two inputs
router passes each message from a data inlet to every outlet that inlet is connected to; inlets and outlets are numbered from 0. A scale goes into inlet 0 and the same scale an octave up into inlet 1. Every 1.6 seconds "patch 0 0" or "patch 1 0" connects one of them to outlet 0 and cuts the other, so the scale jumps between octaves.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, router, select

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
scale = patch.place(counter(60, 67))[0]
up = patch.place("+ 12")[0]
slow = patch.place(metro(1600, active=1))[0]
which = patch.place(counter(0, 1))[0]
pick = patch.place(select(0, 1))[0]
low = patch.place("message patch 0 0")[0]
high = patch.place("message patch 1 0")[0]
patchbay = patch.place(router(2, 1))[0]   # 2 data inlets, 1 outlet
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (slow.outs[0], which.ins[0]),
    (which.outs[0], pick.ins[0]),
    (pick.outs[0], low.ins[0]),
    (pick.outs[1], high.ins[0]),
    (low.outs[0], patchbay.ins[0]),       # the left inlet takes patch / connect / clear
    (high.outs[0], patchbay.ins[0]),
    (clock.outs[0], scale.ins[0]),
    (scale.outs[0], patchbay.ins[1]),     # data inlet 0
    (scale.outs[0], up.ins[0]),
    (up.outs[0], patchbay.ins[2]),        # data inlet 1
    (patchbay.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("router")
