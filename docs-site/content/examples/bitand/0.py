"""Masking bits into a pattern
& keeps only the bits that are also set in its argument. Counting 0..7, & 5 (binary 101) gives 0 1 0 1 4 5 4 5; times 2 above note 60 that is a little two-part figure. Press ▶, then drag the number box (0..7) to try other masks.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, number

patch = mp.MaxPatch()
clock = patch.place(metro(180, active=1))[0]
step = patch.place(counter(0, 7))[0]
mask = patch.place(number)[0]
bits = patch.place("& 5")[0]
tone = patch.place("* 2")[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], bits.ins[0]),
    (mask.outs[0], bits.ins[1]),
    (bits.outs[0], tone.ins[0]),
    (tone.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("bitand")
