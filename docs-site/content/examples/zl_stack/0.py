"""Last in, first out
zl.stack keeps the numbers it receives, and each bang sends out the newest one. The chord goes in from the bottom up, so it comes back out from the top down.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, iter_, metro, mtof, select, trigger, zl_stack

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
beat = patch.place(counter(0, 3))[0]
order = patch.place(trigger("b", "i"))[0]
bar = patch.place(select(0))[0]
chord = patch.place("message 60 64 67 72")[0]
each = patch.place(iter_)[0]             # one number at a time onto the stack
lifo = patch.place(zl_stack)[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], beat.ins[0]),
    (beat.outs[0], order.ins[0]),
    (order.outs[1], bar.ins[0]),       # beat 0: refill the stack
    (bar.outs[0], chord.ins[0]),
    (chord.outs[0], each.ins[0]),
    (each.outs[0], lifo.ins[0]),
    (order.outs[0], lifo.ins[0]),      # every beat: take the top one off
    (lifo.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("zl.stack")
