"""Glide from note to note
pack 0 200 combines the note at its left inlet with the glide time at its right into one list, "note 200", which line slides through in 200 ms. Press ▶, then change the number box to set a new glide time.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, line, metro, mtof, number, pack, random

patch = mp.MaxPatch()
clock = patch.place(metro(400, active=1))[0]
pick = patch.place(random(13))[0]
note = patch.place("+ 60")[0]
glide = patch.place(number)[0]           # milliseconds (cold: waits for a note)
both = patch.place(pack(0, 200))[0]
slide = patch.place(line(60))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], pick.ins[0]),
    (pick.outs[0], note.ins[0]),
    (note.outs[0], both.ins[0]),
    (glide.outs[0], both.ins[1]),
    (both.outs[0], slide.ins[0]),
    (slide.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("pack")
