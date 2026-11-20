"""Stair-step sines
mc.round~ rounds every sample of every channel to a multiple of its argument. With 0.25 two smooth sines become coarse steps. Type a smaller step, like 0.05, in the number box for a cleaner sound.
"""
import maxpylang as mp
from maxpylang.objects import flonum, loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_round_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 220 330")[0]   # 2 channels
osc = patch.place(mc_cycle_tilde(220))[0]
step = patch.place(flonum)[0]               # a new step size for every channel
steps = patch.place(mc_round_tilde(0.25))[0]
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], osc.ins[0]),
    (osc.outs[0], steps.ins[0]),
    (step.outs[0], steps.ins[1]),
    (steps.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_round")
