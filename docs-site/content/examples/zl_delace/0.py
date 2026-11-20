"""Unzip a list into tune and bass
zl.delace sends the 1st, 3rd, 5th ... items out of its left outlet and the 2nd, 4th, 6th ... out of its right. The list alternates tune and bass notes, so it plays as two voices.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, trigger, zl_delace, zl_nth

patch = mp.MaxPatch()
clock = patch.place(metro(300, active=1))[0]
step = patch.place(counter(1, 4))[0]
order = patch.place(trigger("b", "i"))[0]
pairs = patch.place("message 67 48 69 53 71 55 72 48")[0]   # tune, bass, tune, bass ...
unzip = patch.place(zl_delace)[0]
tune = patch.place(zl_nth(1))[0]
bass = patch.place(zl_nth(1))[0]
hz_tune, hz_bass = patch.place(mtof, num_objs=2)
osc_tune, osc_bass = patch.place(cycle_tilde, num_objs=2)
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], order.ins[0]),
    (order.outs[1], tune.ins[1]),
    (order.outs[1], bass.ins[1]),
    (order.outs[0], pairs.ins[0]),
    (pairs.outs[0], unzip.ins[0]),
    (unzip.outs[0], tune.ins[0]),      # 67 69 71 72
    (unzip.outs[1], bass.ins[0]),      # 48 53 55 48
    (tune.outs[0], hz_tune.ins[0]),
    (bass.outs[0], hz_bass.ins[0]),
    (hz_tune.outs[0], osc_tune.ins[0]),
    (hz_bass.outs[0], osc_bass.ins[0]),
    (osc_tune.outs[0], quiet.ins[0]),
    (osc_bass.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("zl.delace")
