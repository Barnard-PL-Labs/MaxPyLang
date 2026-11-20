"""Reading values out of a dictionary
Two message boxes in dictionary syntax take turns: one loud and low, one quiet and high. dict.deserialize turns each into a dictionary, and dict.unpack sends the value of freq out of its first outlet and amp out of its second, so the tone alternates between a loud 220 Hz and a softer 440 Hz.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, dict_deserialize, dict_unpack, ezdac_tilde, metro, select

patch = mp.MaxPatch()
clock = patch.place(metro(400, active=1))[0]
step = patch.place(counter(0, 1))[0]
pick = patch.place(select(0, 1))[0]
loud = patch.place("message freq: 220 amp: 0.25")[0]
soft = patch.place("message freq: 440 amp: 0.08")[0]
make = patch.place(dict_deserialize)[0]
unpack = patch.place(dict_unpack("freq:", "amp:"))[0]
osc = patch.place(cycle_tilde)[0]
level = patch.place("*~")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], pick.ins[0]),
    (pick.outs[0], loud.ins[0]),
    (pick.outs[1], soft.ins[0]),
    (loud.outs[0], make.ins[0]),
    (soft.outs[0], make.ins[0]),
    (make.outs[0], unpack.ins[0]),     # "dictionary u…"
    (unpack.outs[0], osc.ins[0]),      # freq
    (unpack.outs[1], level.ins[1]),    # amp
    (osc.outs[0], level.ins[0]),
    (level.outs[0], out.ins[0]),
    (level.outs[0], out.ins[1]),
)
patch.save("dict.unpack")
