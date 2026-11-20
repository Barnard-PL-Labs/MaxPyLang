"""A dictionary as text, and back
dict.serialize writes a dictionary out as dictionary syntax, freq : 330, the same text a message box could hold; dict.deserialize reads that text back into a dictionary. Each step goes through the round trip, and the frequency that comes out the far end plays.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, dict_deserialize, dict_serialize, dict_unpack, ezdac_tilde, metro

patch = mp.MaxPatch()
clock = patch.place(metro(300, active=1))[0]
step = patch.place(counter(4, 8))[0]
hz = patch.place("* 55")[0]
text = patch.place("message freq: $1")[0]
make = patch.place(dict_deserialize)[0]
write = patch.place(dict_serialize)[0]
read = patch.place(dict_deserialize)[0]
unpack = patch.place(dict_unpack("freq:"))[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], hz.ins[0]),
    (hz.outs[0], text.ins[0]),
    (text.outs[0], make.ins[0]),
    (make.outs[0], write.ins[0]),
    (write.outs[0], read.ins[0]),      # "freq : 330"
    (read.outs[0], unpack.ins[0]),
    (unpack.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("dict.serialize")
