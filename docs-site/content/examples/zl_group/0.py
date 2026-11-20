"""Collect notes into pairs
zl.group 2 waits for two numbers, then sends them out together as one list. unpack splits each pair onto two oscillators, so random notes arrive as two-note chords.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, mtof, random, unpack, zl_group

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
pick = patch.place(random(13))[0]
note = patch.place("+ 60")[0]
pair = patch.place(zl_group(2))[0]
split = patch.place(unpack(0, 0))[0]
hz_a, hz_b = patch.place(mtof, num_objs=2)
osc_a, osc_b = patch.place(cycle_tilde, num_objs=2)
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], pick.ins[0]),
    (pick.outs[0], note.ins[0]),
    (note.outs[0], pair.ins[0]),
    (pair.outs[0], split.ins[0]),
    (split.outs[0], hz_a.ins[0]),
    (split.outs[1], hz_b.ins[0]),
    (hz_a.outs[0], osc_a.ins[0]),
    (hz_b.outs[0], osc_b.ins[0]),
    (osc_a.outs[0], quiet.ins[0]),
    (osc_b.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("zl.group")
