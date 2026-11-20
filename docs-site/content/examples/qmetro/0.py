"""A metro for the screen
qmetro bangs like metro, but at low priority, so it is the clock for drawing and video. Here every 200 ms it steps a counter through a stack of fourths. Press ▶, then type a new interval into the number box.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, mtof, number, qmetro

patch = mp.MaxPatch()
rate = patch.place(number)[0]
clock = patch.place(qmetro(200, active=1))[0]
step = patch.place(counter(0, 4))[0]
fourths = patch.place("* 5")[0]
note = patch.place("+ 55")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (rate.outs[0], clock.ins[1]),      # right inlet: the interval in ms
    (clock.outs[0], step.ins[0]),
    (step.outs[0], fourths.ins[0]),
    (fourths.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("qmetro")
