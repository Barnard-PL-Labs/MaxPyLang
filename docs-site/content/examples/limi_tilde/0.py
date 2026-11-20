"""A swell held under the ceiling
The tone swells to three times full scale, far past the 1 where a speaker would clip. limi~ looks ahead and turns the peaks down, so the swell flattens out at the top instead of distorting.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, limi_tilde

patch = mp.MaxPatch()
lfo = patch.place(cycle_tilde(0.5))[0]    # once every 2 seconds
span = patch.place("*~ 1.5")[0]
level = patch.place("+~ 1.5")[0]          # 0..3
osc = patch.place(cycle_tilde(220))[0]
loud = patch.place("*~ 0.")[0]            # peaks up to 3
limit = patch.place(limi_tilde)[0]        # back under 1
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (lfo.outs[0], span.ins[0]),
    (span.outs[0], level.ins[0]),
    (osc.outs[0], loud.ins[0]),
    (level.outs[0], loud.ins[1]),
    (loud.outs[0], limit.ins[0]),
    (limit.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("limi_tilde")
