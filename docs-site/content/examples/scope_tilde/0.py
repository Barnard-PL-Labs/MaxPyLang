"""Seeing a waveform
scope~ draws a signal like an oscilloscope. A triangle wave at 220 Hz shows as a zigzag while you hear it.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, scope_tilde, tri_tilde

patch = mp.MaxPatch()
osc = patch.place(tri_tilde(220))[0]
view = patch.place(scope_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (osc.outs[0], view.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("waveform")
