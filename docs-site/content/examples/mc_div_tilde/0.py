"""Divide every channel
mc.div~ divides each channel by its argument. Two frequency signals, 440 and 660, divided by 2 play 220 and 330 Hz. Type 4 in the number box and both drop another octave.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_div_tilde, mc_ezdac_tilde, mc_sig_tilde, number

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 440 660")[0]   # 2 channels
freq = patch.place(mc_sig_tilde(440))[0]
divisor = patch.place(number)[0]            # 1, 2, 4: octaves
half = patch.place(mc_div_tilde(2))[0]
osc = patch.place(mc_cycle_tilde(0))[0]     # 0: the frequency comes from the signal
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], freq.ins[0]),
    (freq.outs[0], half.ins[0]),
    (divisor.outs[0], half.ins[1]),
    (half.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_div")
