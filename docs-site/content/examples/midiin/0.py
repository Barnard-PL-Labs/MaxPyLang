"""Playing a sine from a MIDI keyboard
midiin receives raw MIDI bytes; midiparse sorts them, sending each note as a pitch and velocity. The pitch sets the frequency of a sine (note-offs repeat the last pitch, so the tone holds). In Max, double-click midiin to pick the keyboard.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, midiin, midiparse, mtof, unpack

patch = mp.MaxPatch()
keys = patch.place(midiin)[0]
parse = patch.place(midiparse)[0]
note = patch.place(unpack(0, 0))[0]           # pitch, velocity
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (keys.outs[0], parse.ins[0]),
    (parse.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("midi_sine")
