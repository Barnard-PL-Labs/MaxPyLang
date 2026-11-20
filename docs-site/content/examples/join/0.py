"""An envelope in two halves
join combines the lists at its inlets into one list. "1 5" (rise in 5 ms) and "0 300" (fall in 300 ms) join into the envelope "1 5 0 300" for line~, which strikes the tone on every beat.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, join, line_tilde, metro, trigger

patch = mp.MaxPatch()
clock = patch.place(metro(400, active=1))[0]
order = patch.place(trigger("b", "b"))[0]
rise = patch.place("message 1 5")[0]
fall = patch.place("message 0 300")[0]
glue = patch.place(join(2))[0]
env = patch.place(line_tilde)[0]
osc = patch.place(cycle_tilde(330))[0]
amp = patch.place("*~ 0.")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], order.ins[0]),
    (order.outs[1], fall.ins[0]),      # right inlet first: stored
    (fall.outs[0], glue.ins[1]),
    (order.outs[0], rise.ins[0]),      # left inlet sends the joined list
    (rise.outs[0], glue.ins[0]),
    (glue.outs[0], env.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("join")
