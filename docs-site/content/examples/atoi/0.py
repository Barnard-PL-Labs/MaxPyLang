"""Play a word
atoi turns a word into the character code of each letter: "hello" becomes 104 101 108 108 111. Less 36, those codes are notes, and zl.nth plays them in turn.
"""
import maxpylang as mp
from maxpylang.objects import atoi, counter, cycle_tilde, ezdac_tilde, metro, mtof, trigger, zl_nth

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(1, 5))[0]
order = patch.place(trigger("b", "i"))[0]
word = patch.place("message hello")[0]
codes = patch.place(atoi)[0]
pick = patch.place(zl_nth(1))[0]
note = patch.place("- 36")[0]            # h = 104 -> 68
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], order.ins[0]),
    (order.outs[1], pick.ins[1]),
    (order.outs[0], word.ins[0]),
    (word.outs[0], codes.ins[0]),
    (codes.outs[0], pick.ins[0]),
    (pick.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("atoi")
