"""A three-voice canon
bucket passes numbers along its outlets like a bucket brigade: each new number goes out the first outlet, and the number each outlet sent last time moves on to the next. A rising scale goes in; the three outlets play it, one step and two steps behind, on three sines.
"""
import maxpylang as mp
from maxpylang.objects import bucket, counter, cycle_tilde, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(300, active=1))[0]
scale = patch.place(counter(60, 72))[0]
brigade = patch.place(bucket(3))[0]          # 3 outlets
hz = patch.place(mtof, num_objs=3)
osc = patch.place(cycle_tilde, num_objs=3)
mix = patch.place("*~ 0.1")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], scale.ins[0]),
    (scale.outs[0], brigade.ins[0]),
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
patch.save("bucket_canon")
