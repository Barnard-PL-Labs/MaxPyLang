"""A three-voice canon
bucket 3 passes each number it receives from outlet to outlet, one step at a time, like a bucket brigade. A counter climbs in fourths; each new step sends out what bucket already holds, so its three outlets play the same line one, two and three steps behind. The voices come in one after another and then move together as a chord of fourths.
"""
import maxpylang as mp
from maxpylang.objects import bucket, counter, cycle_tilde, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(400, active=1))[0]
step = patch.place(counter(0, 7))[0]
fourths = patch.place("* 5")[0]
base = patch.place("+ 48")[0]
brigade = patch.place(bucket(3))[0]           # 3 outlets: 1, 2 and 3 steps behind
hz = patch.place(mtof, num_objs=3)
osc = patch.place(cycle_tilde, num_objs=3)
mix = patch.place("*~ 0.1")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], fourths.ins[0]),
    (fourths.outs[0], base.ins[0]),
    (base.outs[0], brigade.ins[0]),
    (brigade.outs[0], hz[0].ins[0]),
    (brigade.outs[1], hz[1].ins[0]),
    (brigade.outs[2], hz[2].ins[0]),
    (hz[0].outs[0], osc[0].ins[0]),
    (hz[1].outs[0], osc[1].ins[0]),
    (hz[2].outs[0], osc[2].ins[0]),
    (osc[0].outs[0], mix.ins[0]),
    (osc[1].outs[0], mix.ins[0]),
    (osc[2].outs[0], mix.ins[0]),
    (mix.outs[0], out.ins[0]),
    (mix.outs[0], out.ins[1]),
)
patch.save("bucket")
