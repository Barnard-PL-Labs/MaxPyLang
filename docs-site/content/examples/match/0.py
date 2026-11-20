"""Ring a bell on a pattern
match 7 0 waits for the numbers 7 then 0 in a row and sends them out when they come. The counter goes 7 then 0 each time it starts over, so a high bell rings at the top of every bar.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, line_tilde, match, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
step = patch.place(counter(0, 7))[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
tune = patch.place(cycle_tilde)[0]
spot = patch.place(match(7, 0))[0]
strike = patch.place("message 1 5 0 600")[0]
env = patch.place(line_tilde)[0]
bell = patch.place(cycle_tilde(1568))[0]
amp = patch.place("*~ 0.")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], tune.ins[0]),
    (step.outs[0], spot.ins[0]),
    (spot.outs[0], strike.ins[0]),
    (strike.outs[0], env.ins[0]),
    (bell.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),
    (tune.outs[0], quiet.ins[0]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("match")
