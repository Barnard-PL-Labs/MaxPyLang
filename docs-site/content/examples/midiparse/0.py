"""Read raw MIDI
midiparse sorts raw MIDI bytes by type: notes come out its left outlet as "pitch velocity". Here midiformat makes the bytes for random notes, so no device is needed, and unpack takes the pitch for the oscillator.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, midiformat, midiparse, mtof, pack, random, unpack

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
pick = patch.place(random(12))[0]
note = patch.place("+ 60")[0]
pair = patch.place(pack(0, 100))[0]    # pitch, velocity
raw = patch.place(midiformat)[0]
parse = patch.place(midiparse)[0]
split = patch.place(unpack(0, 0))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], pick.ins[0]), (pick.outs[0], note.ins[0]), (note.outs[0], pair.ins[0]),
    (pair.outs[0], raw.ins[0]), (raw.outs[0], parse.ins[0]),
    (parse.outs[0], split.ins[0]),     # note: pitch velocity
    (split.outs[0], hz.ins[0]), (hz.outs[0], osc.ins[0]), (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]),
)
patch.save("midiparse")
