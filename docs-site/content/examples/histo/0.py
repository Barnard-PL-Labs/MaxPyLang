"""Counting how often each note comes round
histo counts how many times it has received each number. A counter steps through 0 to 3, played as a rising arpeggio on one sine; histo sends out how many times that step has now come round, and that count moves a low sine up a whole tone each time the arpeggio repeats (after six laps it starts again from the bottom).
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, histo, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(300, active=1))[0]
step = patch.place(counter(0, 3))[0]
tally = patch.place(histo)[0]                 # left: the number, right: how many times so far
spread = patch.place("* 4")[0]
high = patch.place("+ 60")[0]
laps = patch.place("% 6")[0]
tone = patch.place("* 2")[0]
low = patch.place("+ 36")[0]
hz = patch.place(mtof, num_objs=2)
osc = patch.place(cycle_tilde, num_objs=2)
mix = patch.place("*~ 0.15")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], tally.ins[0]),
    (tally.outs[0], spread.ins[0]),
    (spread.outs[0], high.ins[0]),
    (high.outs[0], hz[0].ins[0]),
    (tally.outs[1], laps.ins[0]),
    (laps.outs[0], tone.ins[0]),
    (tone.outs[0], low.ins[0]),
    (low.outs[0], hz[1].ins[0]),
    (hz[0].outs[0], osc[0].ins[0]),
    (hz[1].outs[0], osc[1].ins[0]),
    (osc[0].outs[0], mix.ins[0]),
    (osc[1].outs[0], mix.ins[0]),
    (mix.outs[0], out.ins[0]),
    (mix.outs[0], out.ins[1]),
)
patch.save("histo")
