"""An instrument's output
plugout~ is a Max for Live device's audio output: its left and right inlets go to the track in Live. Here a metro plays a short arpeggio on a triangle wave, saved as an instrument device.
"""
import maxpylang as mp
from maxpylang.objects import counter, metro, mtof, plugout_tilde, tri_tilde

patch = mp.MaxPatch()
clock = patch.place(metro(180, active=1))[0]
step = patch.place(counter(0, 3))[0]
chord = patch.place("* 4")[0]                 # 0, 4, 8, 12: an augmented arpeggio
up = patch.place("+ 57")[0]
hz = patch.place(mtof)[0]
osc = patch.place(tri_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(plugout_tilde)[0]           # left and right, to the track

patch.connect(
    (clock.outs[0], step.ins[0]), (step.outs[0], chord.ins[0]), (chord.outs[0], up.ins[0]),
    (up.outs[0], hz.ins[0]), (hz.outs[0], osc.ins[0]), (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]),
)
patch.save("arpeggio.amxd", device_type="instrument")
