"""Packing values into a dictionary
dict.pack has an inlet for each key it names: freq and amp. Each new pitch from the counter arrives at the freq inlet, which sends the dictionary on; amp keeps its default of 0.2. dict.unpack takes the dictionary apart again, so you hear a rising scale of eight notes, over and over.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, dict_pack, dict_unpack, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(60, 67))[0]
hz = patch.place(mtof)[0]
pack = patch.place(dict_pack("freq:", "amp:", 0.2))[0]
unpack = patch.place(dict_unpack("freq:", "amp:"))[0]
osc = patch.place(cycle_tilde)[0]
level = patch.place("*~")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], hz.ins[0]),
    (hz.outs[0], pack.ins[0]),         # the freq inlet: sets freq and sends
    (pack.outs[0], unpack.ins[0]),     # "dictionary u…"
    (unpack.outs[0], osc.ins[0]),      # freq
    (unpack.outs[1], level.ins[1]),    # amp
    (osc.outs[0], level.ins[0]),
    (level.outs[0], out.ins[0]),
    (level.outs[0], out.ins[1]),
)
patch.save("dict.pack")
