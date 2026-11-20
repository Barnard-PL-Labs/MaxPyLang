"""Flip a coin
decide outputs 0 or 1 at random on each bang. Times 12 plus 57, that picks between two A's an octave apart, every 200 ms.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, decide, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
coin = patch.place(decide)[0]
octave = patch.place("* 12")[0]
note = patch.place("+ 57")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], coin.ins[0]),
    (coin.outs[0], octave.ins[0]),
    (octave.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("decide")
