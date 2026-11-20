"""Seeing a spectrum
spectroscope~ draws how loud each frequency is. White noise through a resonant low-pass filter shows as a hump at 800 Hz that falls away above it.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, lores_tilde, noise_tilde, spectroscope_tilde

patch = mp.MaxPatch()
hiss = patch.place(noise_tilde)[0]
filt = patch.place(lores_tilde(800, 0.9))[0]   # cutoff (Hz), resonance
view = patch.place(spectroscope_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (hiss.outs[0], filt.ins[0]),
    (filt.outs[0], view.ins[0]),
    (filt.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("spectrum")
