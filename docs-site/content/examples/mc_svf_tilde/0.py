"""Band-pass on every channel
mc.svf~ gives low-, high-, band-pass and notch for each channel. This plays the band-pass (outlet 2) of two sawtooths; turn the dial to move the band from 300 to 3000 Hz.
"""
import maxpylang as mp
from maxpylang.objects import dial, loadbang, mc_ezdac_tilde, mc_saw_tilde, mc_svf_tilde, scale

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 110 147")[0]   # 2 channels
saw = patch.place(mc_saw_tilde(110))[0]
knob = patch.place(dial)[0]                 # 0..127
freq = patch.place(scale(0, 127, 300, 3000))[0]
filt = patch.place(mc_svf_tilde(1200, 0.8))[0]   # frequency, resonance
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], saw.ins[0]),
    (saw.outs[0], filt.ins[0]),
    (knob.outs[0], freq.ins[0]),
    (freq.outs[0], filt.ins[1]),
    (filt.outs[2], quiet.ins[0]),           # outlet 2: band-pass, all channels
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_svf")
