"""Play with your computer keyboard
key sends the code of each key you press on the computer keyboard. % 12 folds every code into one octave, + 60 starts it at middle C, and mtof turns it into hertz. Press ▶, then press keys on your keyboard: each key plays its own note.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, key, mtof

patch = mp.MaxPatch()
keys = patch.place(key)[0]
fold = patch.place("% 12")[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde(262))[0]     # middle C until you press a key
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (keys.outs[0], fold.ins[0]),
    (fold.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("key")
