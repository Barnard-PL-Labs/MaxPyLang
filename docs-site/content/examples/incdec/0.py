"""Step through the semitones
incdec is a pair of arrows: each click adds or subtracts 1 and sends the new number. + 60 makes it a MIDI note counted from middle C, and mtof turns that into hertz. Press ▶, then click the up and down arrows to walk the pitch one semitone at a time.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, incdec, mtof

patch = mp.MaxPatch()
arrows = patch.place(incdec)[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde(262))[0]     # middle C until you click
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (arrows.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("incdec")
