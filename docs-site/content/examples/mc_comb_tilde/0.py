"""Metallic noise, left and right
mc.comb~ runs a comb filter on each channel: a 5 ms delay fed back at 0.9 gives two noise streams a pitch near 200 Hz. Turn the dial to change the feedback, from dry (0) to ringing (0.95).
"""
import maxpylang as mp
from maxpylang.objects import dial, loadbang, mc_comb_tilde, mc_ezdac_tilde, mc_noise_tilde, scale

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2")[0]  # 2 channels, each its own noise
hiss = patch.place(mc_noise_tilde)[0]
knob = patch.place(dial)[0]                 # 0..127
amount = patch.place(scale(0, 127, 0., 0.95))[0]
comb = patch.place(mc_comb_tilde(50, 5, 0.3, 0, 0.9))[0]   # max ms, delay ms, gain, ff, feedback
quiet = patch.place("mc.*~ 0.05")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], hiss.ins[0]),
    (hiss.outs[0], comb.ins[0]),
    (knob.outs[0], amount.ins[0]),
    (amount.outs[0], comb.ins[4]),          # inlet 4: feedback
    (comb.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_comb")
