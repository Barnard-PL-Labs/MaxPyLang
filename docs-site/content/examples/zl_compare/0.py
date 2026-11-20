"""Hear when two lists match
zl.compare sends 1 when the list at its left inlet equals the one at its right, and 0 when not. The counter's numbers go by in pairs, and each time a pair is "0 1" the note jumps up a fifth.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, loadbang, metro, mtof, zl_compare, zl_group

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
target = patch.place("message 0 1")[0]
clock = patch.place(metro(150, active=1))[0]
step = patch.place(counter(0, 2))[0]     # 0 1 2 0 1 2 ...
pair = patch.place(zl_group(2))[0]       # (0 1) (2 0) (1 2) (0 1) ...
same = patch.place(zl_compare)[0]
fifth = patch.place("* 7")[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], target.ins[0]),
    (target.outs[0], same.ins[1]),     # the list to look for
    (clock.outs[0], step.ins[0]),
    (step.outs[0], pair.ins[0]),
    (pair.outs[0], same.ins[0]),
    (same.outs[0], fifth.ins[0]),
    (fifth.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("zl.compare")
