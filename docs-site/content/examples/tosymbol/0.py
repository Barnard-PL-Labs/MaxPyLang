"""Hear the digits
tosymbol turns a whole message into one symbol, the text "60 64 67". atoi then gives the character code of each digit and space (6 is 54, a space 32), and those codes play as a tune.
"""
import maxpylang as mp
from maxpylang.objects import atoi, counter, cycle_tilde, ezdac_tilde, metro, mtof, tosymbol, trigger, zl_nth

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
step = patch.place(counter(1, 8))[0]     # "60 64 67" is 8 characters
order = patch.place(trigger("b", "i"))[0]
numbers = patch.place("message 60 64 67")[0]
text = patch.place(tosymbol)[0]
codes = patch.place(atoi)[0]
pick = patch.place(zl_nth(1))[0]
note = patch.place("+ 12")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], order.ins[0]),
    (order.outs[1], pick.ins[1]),
    (order.outs[0], numbers.ins[0]),
    (numbers.outs[0], text.ins[0]),
    (text.outs[0], codes.ins[0]),
    (codes.outs[0], pick.ins[0]),
    (pick.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("tosymbol")
