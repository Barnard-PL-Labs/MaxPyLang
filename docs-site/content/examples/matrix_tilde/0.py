"""Crossfade two tones
matrix~ 2 1 mixes two inputs into one output. A list "inlet outlet gain ramp-ms" sets one connection, so each message fades one tone in and the other out over 300 ms, every second.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, matrix_tilde, metro, select

patch = mp.MaxPatch()
clock = patch.place(metro(1000, active=1))[0]
which = patch.place(counter(0, 1))[0]
pick = patch.place(select(0, 1))[0]
to_a = patch.place("message 0 0 1. 300, 1 0 0. 300")[0]   # in 0 up, in 1 down
to_b = patch.place("message 0 0 0. 300, 1 0 1. 300")[0]   # in 0 down, in 1 up
low = patch.place(cycle_tilde(220))[0]
high = patch.place(cycle_tilde(330))[0]
mix = patch.place(matrix_tilde(2, 1))[0]   # 2 inlets, 1 outlet; every gain starts at 0
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], which.ins[0]), (which.outs[0], pick.ins[0]),
    (pick.outs[0], to_a.ins[0]), (pick.outs[1], to_b.ins[0]),
    (to_a.outs[0], mix.ins[0]), (to_b.outs[0], mix.ins[0]),
    (low.outs[0], mix.ins[0]),
    (high.outs[0], mix.ins[1]),
    (mix.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("matrix_tilde")
