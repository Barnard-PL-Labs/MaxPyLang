"""Switch up an octave
A toggle is an on/off switch: clicking it sends 1, clicking again sends 0. * 12 and + 57 turn that into MIDI note 57 or 69, an octave apart. Press ▶, then click the toggle to jump between the two notes.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, mtof, toggle

patch = mp.MaxPatch()
switch = patch.place(toggle)[0]
octave = patch.place("* 12")[0]
note = patch.place("+ 57")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde(220))[0]     # note 57, the toggle's "off"
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (switch.outs[0], octave.ins[0]),
    (octave.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("toggle")
