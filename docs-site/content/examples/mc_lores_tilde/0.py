"""One dial, two filters
mc.lores~ is a resonant low-pass on each channel. Two sawtooths go through it at an 800 Hz cutoff; turn the dial to sweep both filters together, from 200 to 3000 Hz.
"""
import maxpylang as mp
from maxpylang.objects import dial, loadbang, mc_ezdac_tilde, mc_lores_tilde, mc_saw_tilde, scale

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 98 147")[0]    # 2 channels
saw = patch.place(mc_saw_tilde(98))[0]
knob = patch.place(dial)[0]                 # 0..127
cutoff = patch.place(scale(0, 127, 200, 3000))[0]
filt = patch.place(mc_lores_tilde(800, 0.8))[0]   # cutoff Hz, resonance
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], saw.ins[0]),
    (saw.outs[0], filt.ins[0]),
    (knob.outs[0], cutoff.ins[0]),
    (cutoff.outs[0], filt.ins[1]),          # a number reaches every channel
    (filt.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_lores")
