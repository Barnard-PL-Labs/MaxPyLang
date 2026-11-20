"""How busy is the rhythm?
lessthan is the long name of <. random picks 0..99; lessthan 30 is 1 about 30% of the time, and that opens the tone, so roughly three ticks in ten play. Press ▶, then drag the number box (0..100) to set the percentage.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, number, random

patch = mp.MaxPatch()
clock = patch.place(metro(100, active=1))[0]
pick = patch.place(random(100))[0]
density = patch.place(number)[0]
chance = patch.place("lessthan 30")[0]
osc = patch.place(cycle_tilde(523))[0]
gate = patch.place("*~ 0.")[0]       # 1 lets the tone through, 0 silences it
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], pick.ins[0]),
    (pick.outs[0], chance.ins[0]),
    (density.outs[0], chance.ins[1]),
    (chance.outs[0], gate.ins[1]),
    (osc.outs[0], gate.ins[0]),
    (gate.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("lessthan")
