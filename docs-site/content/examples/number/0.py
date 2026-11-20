"""Type a note number
A number box holds a whole number and sends it when it changes. Here it is a MIDI note: mtof turns it into hertz for tri~. Press ▶, then drag up and down on the number box, or click it and type a note (60 is middle C, 72 an octave up).
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, mtof, number, tri_tilde

patch = mp.MaxPatch()
note = patch.place(number)[0]
hz = patch.place(mtof)[0]
osc = patch.place(tri_tilde(262))[0]       # middle C until you set a number
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("number")
