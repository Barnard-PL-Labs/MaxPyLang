"""Text into a dictionary
dict.deserialize reads dictionary syntax, key, colon, value, and makes a dictionary of it. The counter steps 4 to 8; times 55 that is 220 to 440 Hz; the message box puts it after "freq:" ($1 is the number that arrived); dict.unpack takes freq back out, and a sine plays it.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, dict_deserialize, dict_unpack, ezdac_tilde, metro

patch = mp.MaxPatch()
clock = patch.place(metro(300, active=1))[0]
step = patch.place(counter(4, 8))[0]
hz = patch.place("* 55")[0]
text = patch.place("message freq: $1")[0]
make = patch.place(dict_deserialize)[0]
unpack = patch.place(dict_unpack("freq:"))[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], hz.ins[0]),
    (hz.outs[0], text.ins[0]),
    (text.outs[0], make.ins[0]),
    (make.outs[0], unpack.ins[0]),     # "dictionary u…"
    (unpack.outs[0], osc.ins[0]),      # freq
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("dict.deserialize")
