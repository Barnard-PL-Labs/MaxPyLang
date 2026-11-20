"""Play notes on a keyboard
kslider is a piano keyboard: clicking a key sends its MIDI note number. mtof turns it into hertz for cycle~, which a metro plucks four times a second. Press ▶, then click the keys of the kslider to change the note.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, kslider, line_tilde, metro, mtof

patch = mp.MaxPatch()
keys = patch.place(kslider)[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde(262))[0]     # middle C until you click a key
clock = patch.place(metro(250, active=1))[0]
shape = patch.place("message 1 5 0 200")[0]
env = patch.place(line_tilde)[0]
amp = patch.place("*~ 0.")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (keys.outs[0], hz.ins[0]),           # left outlet: the note; right: velocity
    (hz.outs[0], osc.ins[0]),
    (clock.outs[0], shape.ins[0]),
    (shape.outs[0], env.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("kslider")
