"""Drop the note-offs
stripnote passes a pitch only when the velocity in its right inlet is not 0. decide gives each step velocity 100 or 0 (a note-off), so only some steps of the scale pluck; the rest are rests.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, decide, ezdac_tilde, line_tilde, metro, mtof, stripnote

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
order = patch.place("t b b")[0]
coin = patch.place(decide)[0]
velocity = patch.place("* 100")[0]
step = patch.place(counter(60, 67))[0]
ons = patch.place(stripnote)[0]
hz = patch.place(mtof)[0]
pluck = patch.place("message 1 5 0 180")[0]
env = patch.place(line_tilde)[0]
osc = patch.place(cycle_tilde)[0]
amp = patch.place("*~ 0.")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], order.ins[0]), (order.outs[1], coin.ins[0]), (coin.outs[0], velocity.ins[0]),
    (velocity.outs[0], ons.ins[1]), (order.outs[0], step.ins[0]), (step.outs[0], ons.ins[0]),
    (ons.outs[0], hz.ins[0]), (hz.outs[0], osc.ins[0]), (ons.outs[1], pluck.ins[0]),
    (pluck.outs[0], env.ins[0]), (osc.outs[0], amp.ins[0]), (env.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]), (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]),
)
patch.save("stripnote")
