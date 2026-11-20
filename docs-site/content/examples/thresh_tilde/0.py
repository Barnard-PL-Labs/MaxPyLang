"""Turn a slow wave into on and off
thresh~ 0 0.5 outputs 1 once its input rises past 0.5 and 0 once it falls below 0. Fed a 1 Hz sine, it switches a tone on and off; rampsmooth~ rounds each switch over 10 ms so it doesn't click.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, rampsmooth_tilde, thresh_tilde

patch = mp.MaxPatch()
lfo = patch.place(cycle_tilde(1))[0]
switch = patch.place(thresh_tilde(0, 0.5))[0]       # reset below 0, set above 0.5
soft = patch.place(rampsmooth_tilde(441, 441))[0]   # 441 samples = 10 ms
osc = patch.place(cycle_tilde(523))[0]
amp = patch.place("*~ 0.")[0]                       # times the 0/1 switch
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (lfo.outs[0], switch.ins[0]),
    (switch.outs[0], soft.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (soft.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("thresh_tilde")
