"""Mixing two multichannel inputs
mc.matrix~ 2 1 routes two inputs to one output with a gain for each connection. "0 0 0.5" sends input 0 (a chord) at half level and "1 0 0.05" adds a little of input 1 (noise), on both channels.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_matrix_tilde, mc_noise_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 220 330")[0]   # 2 channels of tone
two = patch.place("message chans 2")[0]     # 2 channels of noise
gains = patch.place("message 0 0 0.5, 1 0 0.05")[0]   # inlet, outlet, gain
osc = patch.place(mc_cycle_tilde(220))[0]
hiss = patch.place(mc_noise_tilde)[0]
mixer = patch.place(mc_matrix_tilde(2, 1, 0.))[0]   # 2 in, 1 out, all gains 0 at first
quiet = patch.place("mc.*~ 0.3")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (start.outs[0], two.ins[0]),
    (start.outs[0], gains.ins[0]),
    (voices.outs[0], osc.ins[0]),
    (two.outs[0], hiss.ins[0]),
    (gains.outs[0], mixer.ins[0]),
    (osc.outs[0], mixer.ins[0]),
    (hiss.outs[0], mixer.ins[1]),
    (mixer.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_matrix")
