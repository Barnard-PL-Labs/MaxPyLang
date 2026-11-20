"""Two voices that move together
bondo keeps the last value at each inlet, and whenever any inlet gets a new one it sends all of them out. A melody steps on the left every 400 ms and a slower bass line on the right every 1000 ms; both sines change whenever either line moves.
"""
import maxpylang as mp
from maxpylang.objects import bondo, counter, cycle_tilde, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
fast = patch.place(metro(400, active=1))[0]
melody = patch.place(counter(67, 74))[0]
slow = patch.place(metro(1000, active=1))[0]
bass = patch.place(counter(43, 48))[0]
sync = patch.place(bondo(2))[0]
hz = patch.place(mtof, num_objs=2)
osc = patch.place(cycle_tilde, num_objs=2)
mix = patch.place("*~ 0.15")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (fast.outs[0], melody.ins[0]),
    (slow.outs[0], bass.ins[0]),
    (melody.outs[0], sync.ins[0]),
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
patch.save("bondo_sync")
