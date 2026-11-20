"""Strike only new notes
zl.change lets a message through only when it differs from the one before. random picks one of 3 notes, often the same again; repeats are dropped, so they never strike a new note. Press ▶, then set the number box to 6: with more notes to pick from, repeats are rarer and more beats strike.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, line_tilde, metro, mtof, number, random, trigger, zl_change

patch = mp.MaxPatch()
clock = patch.place(metro(150, active=1))[0]
pick = patch.place(random(3))[0]
choices = patch.place(number)[0]         # how many notes random picks from
new = patch.place(zl_change)[0]
order = patch.place(trigger("b", "i"))[0]   # set the pitch, then strike
spread = patch.place("* 5")[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
strike = patch.place("message 1 5 0 300")[0]   # up in 5 ms, down in 300
env = patch.place(line_tilde)[0]
osc = patch.place(cycle_tilde)[0]
amp = patch.place("*~ 0.")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], pick.ins[0]),
    (choices.outs[0], pick.ins[1]),
    (pick.outs[0], new.ins[0]),
    (new.outs[0], order.ins[0]),
    (order.outs[1], spread.ins[0]),
    (spread.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (order.outs[0], strike.ins[0]),
    (strike.outs[0], env.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("zl.change")
