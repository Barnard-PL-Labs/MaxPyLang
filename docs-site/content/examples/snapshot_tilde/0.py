"""Audio to numbers
snapshot~ samples a signal as a number, here every 125 ms. A slow sine becomes a stepping melody: scale maps -1..1 to MIDI notes 60..72.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, mtof, scale, snapshot_tilde

patch = mp.MaxPatch()
lfo = patch.place(cycle_tilde(0.2))[0]
grab = patch.place(snapshot_tilde(125))[0]   # report every 125 ms
note = patch.place(scale(-1, 1, 60, 72))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (lfo.outs[0], grab.ins[0]),
    (grab.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("snapshot")
