"""A pickup into the downbeat
|| outputs 1 when either inlet is non-zero. trigger sends each beat right first, to > 5 (beats 6 and 7) into the cold inlet, then left to < 1 (beat 0): beats 6, 7 and 0 jump an octave, leading into each bar.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, scale, trigger

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
beat = patch.place(counter(0, 7))[0]
both = patch.place(trigger("i", "i"))[0]
end = patch.place("> 5")[0]
start = patch.place("< 1")[0]
or_ = patch.place("|| 0")[0]
note = patch.place(scale(0, 1, 62, 74))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], beat.ins[0]),
    (beat.outs[0], both.ins[0]),
    (both.outs[1], end.ins[0]),       # right outlet fires first
    (end.outs[0], or_.ins[1]),
    (both.outs[0], start.ins[0]),
    (start.outs[0], or_.ins[0]),
    (or_.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("logor")
