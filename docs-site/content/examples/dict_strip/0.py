"""Taking a key out of a dictionary
dict.strip removes the keys it names, here amp, from each dictionary that passes: the removed key and its value go out the right outlet, and the dictionary without it out the left. route amp keeps the level, which sets the volume, while freq from the rest sets the pitch.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, dict_deserialize, dict_strip, dict_unpack, ezdac_tilde, metro, route

patch = mp.MaxPatch()
clock = patch.place(metro(300, active=1))[0]
step = patch.place(counter(4, 8))[0]
hz = patch.place("* 55")[0]
text = patch.place("message freq: $1 amp: 0.2")[0]
make = patch.place(dict_deserialize)[0]
strip = patch.place(dict_strip("amp"))[0]
amp = patch.place(route("amp"))[0]
unpack = patch.place(dict_unpack("freq:"))[0]
osc = patch.place(cycle_tilde)[0]
level = patch.place("*~")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], hz.ins[0]),
    (hz.outs[0], text.ins[0]),
    (text.outs[0], make.ins[0]),
    (make.outs[0], strip.ins[0]),
    (strip.outs[1], amp.ins[0]),       # "amp 0.2", taken out
    (amp.outs[0], level.ins[1]),
    (strip.outs[0], unpack.ins[0]),    # the dictionary without amp
    (unpack.outs[0], osc.ins[0]),
    (osc.outs[0], level.ins[0]),
    (level.outs[0], out.ins[0]),
    (level.outs[0], out.ins[1]),
)
patch.save("dict.strip")
