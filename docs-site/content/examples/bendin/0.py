"""The pitch-bend wheel
bendin outputs the bend wheel's position, 0 to 127 with 64 in the middle. Minus 64, divided by 32, that's up to 2 semitones either way around note 60. Play a MIDI keyboard's bend wheel to bend the tone; until then it holds middle C.
"""
import maxpylang as mp
from maxpylang.objects import bendin, cycle_tilde, ezdac_tilde, mtof

patch = mp.MaxPatch()
wheel = patch.place(bendin("a", 1))[0]   # port a, channel 1
centre = patch.place("- 64")[0]
semis = patch.place("/ 32.")[0]
note = patch.place("+ 60.")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde(262))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (wheel.outs[0], centre.ins[0]),
    (centre.outs[0], semis.ins[0]),
    (semis.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("bendin")
