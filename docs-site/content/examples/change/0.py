"""Only new notes start a sound
random picks one of 3 notes every 125 ms, so it often repeats. change passes a number only when it differs from the last, so repeats are silent and only new notes are plucked: an uneven rhythm from a steady clock.
"""
import maxpylang as mp
from maxpylang.objects import change, cycle_tilde, ezdac_tilde, line_tilde, metro, mtof, random

patch = mp.MaxPatch()
clock = patch.place(metro(125, active=1))[0]
pick = patch.place(random(3))[0]
new = patch.place(change)[0]
order = patch.place("t b i")[0]
note = patch.place("* 5")[0]
base = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
pluck = patch.place("message 1 5 0 250")[0]
env = patch.place(line_tilde)[0]
osc = patch.place(cycle_tilde)[0]
amp = patch.place("*~ 0.")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], pick.ins[0]), (pick.outs[0], new.ins[0]), (new.outs[0], order.ins[0]),
    (order.outs[1], note.ins[0]), (note.outs[0], base.ins[0]), (base.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (order.outs[0], pluck.ins[0]), (pluck.outs[0], env.ins[0]),
    (osc.outs[0], amp.ins[0]), (env.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]), (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]),
)
patch.save("change")
