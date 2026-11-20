"""A wavefolder
pong~ folds a signal back whenever it goes past its limits (mode 0, between -1 and 1), so a loud sine turns into a bright, buzzing wave. A slow LFO changes how loud it goes in, so the tone opens and closes.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, pong_tilde

patch = mp.MaxPatch()
osc = patch.place(cycle_tilde(110))[0]
lfo = patch.place(cycle_tilde(0.3))[0]       # once every 3 seconds
depth = patch.place("*~ 2")[0]
level = patch.place("+~ 3")[0]               # a gain swinging 1..5
loud = patch.place("*~ 0.")[0]               # times that gain (0. so the signal sets it)
fold = patch.place(pong_tilde(0, -1, 1))[0]  # mode 0 = fold, low -1, high 1
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (lfo.outs[0], depth.ins[0]), (depth.outs[0], level.ins[0]), (level.outs[0], loud.ins[1]),
    (osc.outs[0], loud.ins[0]), (loud.outs[0], fold.ins[0]),
    (fold.outs[0], quiet.ins[0]), (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]),
)
patch.save("pong")
