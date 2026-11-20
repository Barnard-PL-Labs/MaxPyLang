"""Two sounds by range
split 60 71 sends numbers from 60 to 71 out its left outlet and all others out its right. Random notes in that octave play on the smooth cycle~, the rest on the buzzy saw~.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, mtof, random, saw_tilde, split

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
pick = patch.place(random(36))[0]
note = patch.place("+ 48")[0]
middle = patch.place(split(60, 71))[0]
hz_in = patch.place(mtof)[0]
hz_out = patch.place(mtof)[0]
smooth = patch.place(cycle_tilde)[0]
buzzy = patch.place(saw_tilde)[0]
soft = patch.place("*~ 0.3")[0]
mix = patch.place("+~")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], pick.ins[0]), (pick.outs[0], note.ins[0]), (note.outs[0], middle.ins[0]),
    (middle.outs[0], hz_in.ins[0]), (hz_in.outs[0], smooth.ins[0]),
    (middle.outs[1], hz_out.ins[0]), (hz_out.outs[0], buzzy.ins[0]), (buzzy.outs[0], soft.ins[0]),
    (smooth.outs[0], mix.ins[0]), (soft.outs[0], mix.ins[1]),
    (mix.outs[0], quiet.ins[0]), (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]),
)
patch.save("split")
