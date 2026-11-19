"""Set things up when the patch opens
loadbang sends one bang when the patch starts. Here it sends 392 to cycle~, so the tone starts at G instead of 0 Hz.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, loadbang

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
freq = patch.place("message 392")[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], freq.ins[0]),
    (freq.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("loadbang")
