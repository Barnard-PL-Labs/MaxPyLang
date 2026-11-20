"""Adding keys to a dictionary
dict.join merges two dictionaries: the one arriving on the left, and the one on the right, here set by its arguments to amp: 0.15. Each step makes a dictionary holding only freq; after dict.join it holds amp as well, and dict.unpack sets both the pitch and the level of a sine.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, dict_deserialize, dict_join, dict_unpack, ezdac_tilde, metro

patch = mp.MaxPatch()
clock = patch.place(metro(300, active=1))[0]
step = patch.place(counter(4, 8))[0]
hz = patch.place("* 55")[0]
text = patch.place("message freq: $1")[0]
make = patch.place(dict_deserialize)[0]
join = patch.place(dict_join("amp:", 0.15))[0]
unpack = patch.place(dict_unpack("freq:", "amp:"))[0]
osc = patch.place(cycle_tilde)[0]
level = patch.place("*~")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], hz.ins[0]),
    (hz.outs[0], text.ins[0]),
    (text.outs[0], make.ins[0]),
    (make.outs[0], join.ins[0]),
    (join.outs[0], unpack.ins[0]),
    (unpack.outs[0], osc.ins[0]),      # freq
    (unpack.outs[1], level.ins[1]),    # amp, from dict.join's arguments
    (osc.outs[0], level.ins[0]),
    (level.outs[0], out.ins[0]),
    (level.outs[0], out.ins[1]),
)
patch.save("dict.join")
