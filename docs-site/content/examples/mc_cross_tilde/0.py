"""Splitting highs from lows
mc.cross~ splits every channel at one frequency: lows from the left outlet, highs from the right. This plays only the highs of two sawtooths; turn the dial to move the split from 200 to 4000 Hz.
"""
import maxpylang as mp
from maxpylang.objects import dial, loadbang, mc_cross_tilde, mc_ezdac_tilde, mc_saw_tilde, scale

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 110 165")[0]   # 2 channels
saw = patch.place(mc_saw_tilde(110))[0]
knob = patch.place(dial)[0]                 # 0..127
split = patch.place(scale(0, 127, 200, 4000))[0]
bands = patch.place(mc_cross_tilde(1000))[0]   # crossover at 1000 Hz
quiet = patch.place("mc.*~ 0.3")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], saw.ins[0]),
    (saw.outs[0], bands.ins[0]),
    (knob.outs[0], split.ins[0]),
    (split.outs[0], bands.ins[1]),
    (bands.outs[1], quiet.ins[0]),          # outlet 1: the highs
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_cross")
