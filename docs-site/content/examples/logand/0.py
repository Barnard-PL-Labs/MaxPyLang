"""Both conditions at once
&& outputs 1 only when both inlets are non-zero. trigger sends each beat right first, to % 2 (1 on odd beats) into the cold inlet, then left to > 3 (1 in the second half): only beats 5 and 7 are both, and jump an octave.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, scale, trigger

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
beat = patch.place(counter(0, 7))[0]
both = patch.place(trigger("i", "i"))[0]
odd = patch.place("% 2")[0]
late = patch.place("> 3")[0]
and_ = patch.place("&& 0")[0]
note = patch.place(scale(0, 1, 60, 72))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], beat.ins[0]),
    (beat.outs[0], both.ins[0]),
    (both.outs[1], odd.ins[0]),       # right outlet fires first
    (odd.outs[0], and_.ins[1]),
    (both.outs[0], late.ins[0]),
    (late.outs[0], and_.ins[0]),
    (and_.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("logand")
