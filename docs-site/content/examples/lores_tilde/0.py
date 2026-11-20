"""Filter a buzzy sawtooth
lores~ is a resonant low-pass filter: it keeps frequencies below the cutoff (600 Hz here) and the resonance (0.7) makes a peak there.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, lores_tilde, saw_tilde

patch = mp.MaxPatch()
saw = patch.place(saw_tilde(110))[0]
filt = patch.place(lores_tilde(600, 0.7))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (saw.outs[0], filt.ins[0]),
    (filt.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("lores")
