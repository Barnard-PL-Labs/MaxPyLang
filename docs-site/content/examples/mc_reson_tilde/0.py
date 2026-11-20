"""Noise that rings at two pitches
mc.reson~ is a narrow band-pass on each channel. mc.sig~ gives each channel its own center frequency, so two noise streams whistle at 440 and 660 Hz.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_ezdac_tilde, mc_noise_tilde, mc_reson_tilde, mc_sig_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2")[0]  # 2 channels of noise
centers = patch.place("message chans 2, applyvalues 440 660")[0]
hiss = patch.place(mc_noise_tilde)[0]
center = patch.place(mc_sig_tilde(440))[0]
ring = patch.place(mc_reson_tilde(1, 0, 10))[0]   # gain, center (0: from the signal), Q
quiet = patch.place("mc.*~ 0.5")[0]          # a narrow band is quiet: turn it up a little
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (start.outs[0], centers.ins[0]),
    (voices.outs[0], hiss.ins[0]),
    (centers.outs[0], center.ins[0]),
    (hiss.outs[0], ring.ins[0]),
    (center.outs[0], ring.ins[2]),          # channel 1 to channel 1, 2 to 2
    (ring.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_reson")
