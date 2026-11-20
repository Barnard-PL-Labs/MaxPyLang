"""Darker noise, both sides
mc.onepole~ is a gentle low-pass on each channel. Two streams of noise come out at 500 Hz as a soft roar; drag the slider to open both filters up to 5000 Hz.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_ezdac_tilde, mc_noise_tilde, mc_onepole_tilde, scale, slider

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2")[0]  # 2 channels, each its own noise
hiss = patch.place(mc_noise_tilde)[0]
knob = patch.place(slider)[0]               # 0..127
cutoff = patch.place(scale(0, 127, 100, 5000))[0]
soft = patch.place(mc_onepole_tilde(500))[0]
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], hiss.ins[0]),
    (hiss.outs[0], soft.ins[0]),
    (knob.outs[0], cutoff.ins[0]),
    (cutoff.outs[0], soft.ins[1]),
    (soft.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_onepole")
