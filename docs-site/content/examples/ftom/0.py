"""Tuning random frequencies
ftom turns a frequency into the nearest MIDI note. Random frequencies 200..799 Hz are out of tune; ftom then mtof snaps each one to a piano key.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, ftom, metro, mtof, random

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
pick = patch.place(random(600))[0]
raw = patch.place("+ 200")[0]
note = patch.place(ftom)[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], pick.ins[0]),
    (pick.outs[0], raw.ins[0]),
    (raw.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("ftom")
