"""A smooth U-turn
cosh (hyperbolic cosine) is 1 at 0 and grows on both sides, the curve of a hanging chain. Inputs -2 .. 2 give a pitch that falls fast, slows to 200 Hz at the bottom, and climbs back to 750 Hz.
"""
import maxpylang as mp
from maxpylang.objects import cosh, counter, cycle_tilde, ezdac_tilde, metro

patch = mp.MaxPatch()
clock = patch.place(metro(150, active=1))[0]
step = patch.place(counter(0, 16))[0]
centre = patch.place("- 8")[0]
unit = patch.place("/ 4.")[0]
chain = patch.place(cosh)[0]
hz = patch.place("* 200.")[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], centre.ins[0]),
    (centre.outs[0], unit.ins[0]),
    (unit.outs[0], chain.ins[0]),
    (chain.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("cosh")
