"""A chord from a dictionary
Each dictionary holds three notes under the keys root, third and fifth. dict.iter sends its entries out one at a time as "key value" lists, and route sends each note to its own oscillator, so you hear a C major chord change to an F major chord and back.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, dict_deserialize, dict_iter, ezdac_tilde, metro, mtof, route, select

patch = mp.MaxPatch()
clock = patch.place(metro(1000, active=1))[0]
step = patch.place(counter(0, 1))[0]
pick = patch.place(select(0, 1))[0]
c_major = patch.place("message root: 60 third: 64 fifth: 67")[0]
f_major = patch.place("message root: 65 third: 69 fifth: 72")[0]
make = patch.place(dict_deserialize)[0]
each = patch.place(dict_iter)[0]
by_key = patch.place(route("root", "third", "fifth"))[0]
hz = [patch.place(mtof)[0] for _ in range(3)]
osc = [patch.place(cycle_tilde)[0] for _ in range(3)]
quiet = patch.place("*~ 0.1")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], pick.ins[0]),
    (pick.outs[0], c_major.ins[0]),
    (pick.outs[1], f_major.ins[0]),
    (c_major.outs[0], make.ins[0]),
    (f_major.outs[0], make.ins[0]),
    (make.outs[0], each.ins[0]),
    (each.outs[0], by_key.ins[0]),     # "root 60", "third 64", "fifth 67"
    *[(by_key.outs[i], hz[i].ins[0]) for i in range(3)],
    *[(hz[i].outs[0], osc[i].ins[0]) for i in range(3)],
    *[(osc[i].outs[0], quiet.ins[0]) for i in range(3)],
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("dict.iter")
