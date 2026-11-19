"""A filter sweep
Audio into lores~'s middle inlet moves the cutoff: a slow cycle~ sweeps it between 300 and 1700 Hz.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, lores_tilde, saw_tilde

patch = mp.MaxPatch()
saw = patch.place(saw_tilde(98))[0]
lfo = patch.place(cycle_tilde(0.25))[0]   # once every 4 seconds
span = patch.place("*~ 700")[0]
center = patch.place("+~ 1000")[0]
filt = patch.place(lores_tilde(0, 0.8))[0]   # cutoff from the signal, resonance 0.8
quiet = patch.place("*~ 0.2")[0]        # turn it down
out = patch.place(ezdac_tilde)[0]       # to both speakers

patch.connect(
    (saw.outs[0], filt.ins[0]),
    (lfo.outs[0], span.ins[0]),
    (span.outs[0], center.ins[0]),
    (center.outs[0], filt.ins[1]),
    (filt.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("lores_tilde")
