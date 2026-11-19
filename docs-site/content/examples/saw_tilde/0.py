"""A sawtooth wave
saw~ makes a bright, buzzy tone with every harmonic. Here it plays 110 Hz.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, saw_tilde

patch = mp.MaxPatch()
osc = patch.place(saw_tilde(110))[0]
quiet = patch.place("*~ 0.2")[0]        # turn it down
out = patch.place(ezdac_tilde)[0]       # to both speakers

patch.connect(
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("saw_tilde")
