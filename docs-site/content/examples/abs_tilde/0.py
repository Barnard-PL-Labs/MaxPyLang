"""Fold a slow sine into swells
abs~ flips the negative half of a signal up. A 2 Hz sine used as volume would go silent and back twice a second; folded by abs~, it swells four times a second.
"""
import maxpylang as mp
from maxpylang.objects import abs_tilde, cycle_tilde, ezdac_tilde

patch = mp.MaxPatch()
lfo = patch.place(cycle_tilde(2))[0]
fold = patch.place(abs_tilde)[0]          # -1..1 becomes 0..1
osc = patch.place(cycle_tilde(330))[0]
amp = patch.place("*~ 0.")[0]             # times the swells
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (lfo.outs[0], fold.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (fold.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("abs_tilde")
