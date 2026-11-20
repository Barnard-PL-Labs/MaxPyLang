"""Louder from middle C up
>= outputs 1 when its input is greater than or equal to its argument. A chromatic climb 48..72 plays softly until it reaches 60, where >= 60 turns 1 and the volume jumps up (scale maps 0 and 1 to 0.25 and 1). Press ▶, then drag the number box to move the point where it gets loud.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, number, scale

patch = mp.MaxPatch()
clock = patch.place(metro(150, active=1))[0]
step = patch.place(counter(48, 72))[0]
point = patch.place(number)[0]
high = patch.place(">= 60")[0]
volume = patch.place(scale(0, 1, 0.25, 1.))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
level = patch.place("*~ 0.")[0]      # the right inlet sets the volume
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], high.ins[0]),
    (step.outs[0], hz.ins[0]),
    (point.outs[0], high.ins[1]),
    (high.outs[0], volume.ins[0]),
    (volume.outs[0], level.ins[1]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], level.ins[0]),
    (level.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("greaterthaneq")
