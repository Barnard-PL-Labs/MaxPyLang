"""Keeping two voices in step
bondo remembers the last number in each inlet and, whenever any inlet gets a number, sends all of them out together. A fast melody goes into the left inlet and a slow bass line into the right; each time either one moves, both sines get their notes at the same moment, so you hear the melody stepping every 250 ms over a bass that changes once a second.
"""
import maxpylang as mp
from maxpylang.objects import bondo, counter, cycle_tilde, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
fast = patch.place(metro(250, active=1))[0]
slow = patch.place(metro(1000, active=1))[0]
tune = patch.place(counter(0, 7))[0]
bassline = patch.place(counter(0, 3))[0]
up = patch.place("+ 64")[0]
down = patch.place("* 2")[0]
bass = patch.place("+ 40")[0]
sync = patch.place(bondo)[0]                  # 2 inlets, 2 outlets
hz = patch.place(mtof, num_objs=2)
osc = patch.place(cycle_tilde, num_objs=2)
mix = patch.place("*~ 0.15")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (fast.outs[0], tune.ins[0]),
    (tune.outs[0], up.ins[0]),
    (up.outs[0], sync.ins[0]),
    (slow.outs[0], bassline.ins[0]),
    (bassline.outs[0], down.ins[0]),
    (down.outs[0], bass.ins[0]),
    (bass.outs[0], sync.ins[1]),
    (sync.outs[0], hz[0].ins[0]),
    (sync.outs[1], hz[1].ins[0]),
    (hz[0].outs[0], osc[0].ins[0]),
    (hz[1].outs[0], osc[1].ins[0]),
    (osc[0].outs[0], mix.ins[0]),
    (osc[1].outs[0], mix.ins[0]),
    (mix.outs[0], out.ins[0]),
    (mix.outs[0], out.ins[1]),
)
patch.save("bondo")
