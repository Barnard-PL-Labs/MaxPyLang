"""Two coins, both heads
logand is the long name of &&. On each tick two random 0-or-1 coins go into logand (the right one first, into the cold inlet). It is 1 only when both are heads, so the tone plays about one tick in four.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, random, trigger

patch = mp.MaxPatch()
clock = patch.place(metro(120, active=1))[0]
twice = patch.place(trigger("b", "b"))[0]
coin1 = patch.place(random(2))[0]
coin2 = patch.place(random(2))[0]
heads = patch.place("logand 0")[0]
osc = patch.place(cycle_tilde(587))[0]
gate = patch.place("*~ 0.")[0]       # 1 lets the tone through, 0 silences it
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], twice.ins[0]),
    (twice.outs[1], coin2.ins[0]),
    (coin2.outs[0], heads.ins[1]),
    (twice.outs[0], coin1.ins[0]),
    (coin1.outs[0], heads.ins[0]),
    (heads.outs[0], gate.ins[1]),
    (osc.outs[0], gate.ins[0]),
    (gate.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("logand")
