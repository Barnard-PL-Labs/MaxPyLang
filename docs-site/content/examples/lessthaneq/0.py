"""Accents at the start of the bar
<= outputs 1 while its input is less than or equal to its argument. Counting 0..7, <= 1 is 1 on the first two beats; times 0.7 plus 0.3 makes those loud and the rest soft. Press ▶, then drag the number box to accent more beats.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, number

patch = mp.MaxPatch()
clock = patch.place(metro(180, active=1))[0]
beat = patch.place(counter(0, 7))[0]
last = patch.place(number)[0]
accent = patch.place("<= 1")[0]
boost = patch.place("* 0.7")[0]
soft = patch.place("+ 0.3")[0]
osc = patch.place(cycle_tilde(392))[0]
level = patch.place("*~ 0.")[0]      # the right inlet sets the volume
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], beat.ins[0]),
    (beat.outs[0], accent.ins[0]),
    (last.outs[0], accent.ins[1]),
    (accent.outs[0], boost.ins[0]),
    (boost.outs[0], soft.ins[0]),
    (soft.outs[0], level.ins[1]),
    (osc.outs[0], level.ins[0]),
    (level.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("lessthaneq")
