"""One filter design, every channel
mc.biquad~ runs the same five coefficients on each channel. These make an 800 Hz low-pass (for 44.1 kHz), so two sawtooths a fifth apart both sound muffled.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_biquad_tilde, mc_ezdac_tilde, mc_saw_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 110 165")[0]   # 2 channels
saw = patch.place(mc_saw_tilde(110))[0]
filt = patch.place(mc_biquad_tilde(0.003003, 0.006006, 0.003003, -1.839096, 0.851108))[0]
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], saw.ins[0]),
    (saw.outs[0], filt.ins[0]),
    (filt.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_biquad")
