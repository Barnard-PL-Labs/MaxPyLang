"""Every inlet plays
pak is pack with every inlet hot: a number at any inlet sends the whole list. A slow clock moves the root at the left and a fast one walks a chord at the right; zl.sum adds them, and each change from either side plays.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, pak, zl_sum

patch = mp.MaxPatch()
slow = patch.place(metro(1000, active=1))[0]
roots = patch.place(counter(0, 2))[0]
root = patch.place("* 5")[0]             # 0 5 10: C, F, Bb
fast = patch.place(metro(250, active=1))[0]
steps = patch.place(counter(0, 3))[0]
chord = patch.place("* 4")[0]            # 0 4 8 12
both = patch.place(pak(0, 0))[0]
total = patch.place(zl_sum)[0]
note = patch.place("+ 55")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (slow.outs[0], roots.ins[0]),
    (roots.outs[0], root.ins[0]),
    (root.outs[0], both.ins[0]),
    (fast.outs[0], steps.ins[0]),
    (steps.outs[0], chord.ins[0]),
    (chord.outs[0], both.ins[1]),      # with pack, this inlet would only store
    (both.outs[0], total.ins[0]),
    (total.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("pak")
