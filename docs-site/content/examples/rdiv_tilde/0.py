"""A reciprocal siren
!/~ 330 outputs 330 divided by its input. A slow sine sweeps that input between 0.5 and 1, so the pitch swings between 660 and 330 Hz, lingering longer up high.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde

patch = mp.MaxPatch()
lfo = patch.place(cycle_tilde(0.25))[0]   # once every 4 seconds
span = patch.place("*~ 0.25")[0]
center = patch.place("+~ 0.75")[0]        # 0.5..1
hz = patch.place("!/~ 330")[0]            # 330 / input: 330..660 Hz
osc = patch.place(cycle_tilde(0))[0]      # 0: the frequency comes from the signal
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (lfo.outs[0], span.ins[0]),
    (span.outs[0], center.ins[0]),
    (center.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("rdiv_tilde")
