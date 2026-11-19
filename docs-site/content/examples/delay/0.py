"""A bang, later
delay sends a bang after a time (its argument is required). Each beat plays note 60, and 150 ms later note 67.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, delay, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(600, active=1))[0]
now = patch.place("message 60")[0]
wait = patch.place(delay(150))[0]
later = patch.place("message 67")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], now.ins[0]),
    (clock.outs[0], wait.ins[0]),
    (wait.outs[0], later.ins[0]),
    (now.outs[0], hz.ins[0]),
    (later.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("delay")
