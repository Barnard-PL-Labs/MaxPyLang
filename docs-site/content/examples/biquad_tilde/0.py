"""A filter from coefficients
biquad~ takes the five coefficients of a two-pole filter. These make an 800 Hz low-pass (computed for 44.1 kHz).
"""
import maxpylang as mp
from maxpylang.objects import biquad_tilde, ezdac_tilde, saw_tilde

patch = mp.MaxPatch()
saw = patch.place(saw_tilde(110))[0]
filt = patch.place(biquad_tilde(0.003003, 0.006006, 0.003003, -1.839096, 0.851108))[0]
quiet = patch.place("*~ 0.2")[0]        # turn it down
out = patch.place(ezdac_tilde)[0]       # to both speakers

patch.connect(
    (saw.outs[0], filt.ins[0]),
    (filt.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("biquad_tilde")
