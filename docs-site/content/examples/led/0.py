"""A light on the beat
led lights up when it receives a number other than 0 and goes dark at 0. counter alternates 0 and 1 on every metro tick, which lights the led and also picks the higher of two notes. Press ▶ and watch the led light on each high note.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, led, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(300, active=1))[0]
step = patch.place(counter(0, 1))[0]
light = patch.place(led)[0]
fifth = patch.place("* 7")[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde(262))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], light.ins[0]),
    (step.outs[0], fifth.ins[0]),
    (fifth.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("led")
