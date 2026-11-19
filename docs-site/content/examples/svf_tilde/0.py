"""One filter, four outputs
svf~ outputs low-pass, high-pass, band-pass and notch at once. This plays the band-pass (outlet 2) of a sawtooth.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, saw_tilde, svf_tilde

patch = mp.MaxPatch()
saw = patch.place(saw_tilde(110))[0]
filt = patch.place(svf_tilde(1200, 0.8))[0]   # frequency, resonance
quiet = patch.place("*~ 0.2")[0]        # turn it down
out = patch.place(ezdac_tilde)[0]       # to both speakers

patch.connect(
    (saw.outs[0], filt.ins[0]),
    (filt.outs[2], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("svf_tilde")
