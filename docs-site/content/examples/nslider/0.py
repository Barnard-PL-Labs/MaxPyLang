"""Choose a note on the staff
nslider shows a note on a musical staff and sends its MIDI note number when you change it. mtof turns the note into hertz for tri~. Press ▶, then change the note in the nslider (60 is middle C) to change the pitch.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, mtof, nslider, tri_tilde

patch = mp.MaxPatch()
staff = patch.place(nslider)[0]
hz = patch.place(mtof)[0]
osc = patch.place(tri_tilde(262))[0]       # middle C until you pick a note
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (staff.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("nslider")
