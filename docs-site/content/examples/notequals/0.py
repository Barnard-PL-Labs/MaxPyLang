"""Three beats on, one off
!= outputs 1 when its input differs from its argument. Counting 0..3, != 3 gives 1 1 1 0; as the volume of *~, the tone plays three beats and rests on the fourth. Press ▶, then drag the number box (0..3) to move the rest.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, number

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
beat = patch.place(counter(0, 3))[0]
rest = patch.place(number)[0]
play = patch.place("!= 3")[0]
osc = patch.place(cycle_tilde(330))[0]
gate = patch.place("*~ 0.")[0]       # 1 lets the tone through, 0 silences it
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], beat.ins[0]),
    (beat.outs[0], play.ins[0]),
    (rest.outs[0], play.ins[1]),
    (play.outs[0], gate.ins[1]),
    (osc.outs[0], gate.ins[0]),
    (gate.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("notequals")
