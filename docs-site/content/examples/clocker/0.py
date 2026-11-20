"""How long since it started
clocker reports the milliseconds since it was started, every 50 ms. % 2000 turns that into a sawtooth from 0 to 1999, and scale into a pitch that climbs from 200 to 800 Hz and starts over every 2 seconds.
"""
import maxpylang as mp
from maxpylang.objects import clocker, cycle_tilde, ezdac_tilde, loadmess, scale

patch = mp.MaxPatch()
start = patch.place(loadmess(1))[0]
clock = patch.place(clocker(50))[0]     # report interval, ms
wrap = patch.place("% 2000")[0]
hz = patch.place(scale(0, 2000, 200, 800))[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], clock.ins[0]),
    (clock.outs[0], wrap.ins[0]),
    (wrap.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("clocker")
