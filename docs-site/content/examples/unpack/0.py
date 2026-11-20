"""One list, three notes
unpack 0 0 0 sends each item of a list out of its own outlet. The list "60 64 67" becomes three numbers, one for each of three oscillators, which sound together as a C major chord.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, loadbang, mtof, unpack

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
chord = patch.place("message 60 64 67")[0]
split = patch.place(unpack(0, 0, 0))[0]
hz_a, hz_b, hz_c = patch.place(mtof, num_objs=3)
osc_a, osc_b, osc_c = patch.place(cycle_tilde, num_objs=3)
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], chord.ins[0]),
    (chord.outs[0], split.ins[0]),
    (split.outs[0], hz_a.ins[0]),
    (split.outs[1], hz_b.ins[0]),
    (split.outs[2], hz_c.ins[0]),
    (hz_a.outs[0], osc_a.ins[0]),
    (hz_b.outs[0], osc_b.ins[0]),
    (hz_c.outs[0], osc_c.ins[0]),
    (osc_a.outs[0], quiet.ins[0]),
    (osc_b.outs[0], quiet.ins[0]),
    (osc_c.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("unpack")
