"""Sorting dictionaries
Four dictionaries take turns, each with a side and a pitch. dict.route compares each one with its argument, side: left. The ones that match leave by the left outlet and play in your left ear; the others leave by the right outlet and play in your right ear.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, dict_deserialize, dict_route, dict_unpack, ezdac_tilde, metro, select

patch = mp.MaxPatch()
clock = patch.place(metro(300, active=1))[0]
step = patch.place(counter(0, 3))[0]
pick = patch.place(select(0, 1, 2, 3))[0]
first = patch.place("message side: left freq: 262")[0]
second = patch.place("message side: right freq: 330")[0]
third = patch.place("message side: left freq: 392")[0]
fourth = patch.place("message side: right freq: 523")[0]
make = patch.place(dict_deserialize)[0]
sort = patch.place(dict_route("side:", "left"))[0]
left_freq = patch.place(dict_unpack("freq:"))[0]
right_freq = patch.place(dict_unpack("freq:"))[0]
left_osc = patch.place(cycle_tilde)[0]
right_osc = patch.place(cycle_tilde)[0]
left_quiet = patch.place("*~ 0.2")[0]
right_quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], pick.ins[0]),
    (pick.outs[0], first.ins[0]),
    (pick.outs[1], second.ins[0]),
    (pick.outs[2], third.ins[0]),
    (pick.outs[3], fourth.ins[0]),
    (first.outs[0], make.ins[0]),
    (second.outs[0], make.ins[0]),
    (third.outs[0], make.ins[0]),
    (fourth.outs[0], make.ins[0]),
    (make.outs[0], sort.ins[0]),
    (sort.outs[0], left_freq.ins[0]),   # side is left
    (sort.outs[1], right_freq.ins[0]),  # anything else
    (left_freq.outs[0], left_osc.ins[0]),
    (right_freq.outs[0], right_osc.ins[0]),
    (left_osc.outs[0], left_quiet.ins[0]),
    (right_osc.outs[0], right_quiet.ins[0]),
    (left_quiet.outs[0], out.ins[0]),
    (right_quiet.outs[0], out.ins[1]),
)
patch.save("dict.route")
