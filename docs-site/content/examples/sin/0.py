"""A melody shaped like a sine wave
sin turns an angle (in radians) into a value from -1 to 1. Counting 0..31 in steps of 2π/32 makes one full turn, so the pitch rises and falls smoothly around note 66. Press ▶, then drag the number box to set how many semitones it swings.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, number, sin

patch = mp.MaxPatch()
clock = patch.place(metro(100, active=1))[0]
step = patch.place(counter(0, 31))[0]
angle = patch.place("* 0.19635")[0]   # 2π / 32
wave = patch.place(sin)[0]
width = patch.place(number)[0]
depth = patch.place("* 12.")[0]
note = patch.place("+ 66.")[0]        # float arguments keep the fractions
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], angle.ins[0]),
    (angle.outs[0], wave.ins[0]),
    (wave.outs[0], depth.ins[0]),
    (width.outs[0], depth.ins[1]),
    (depth.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("sin")
