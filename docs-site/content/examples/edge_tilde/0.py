"""Two notes from one switch
edge~ bangs its left outlet when a signal turns non-zero and its right outlet when it returns to zero. thresh~ makes a 1 Hz on/off signal, and the two bangs alternate the tone between 660 and 440 Hz.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, edge_tilde, ezdac_tilde, thresh_tilde

patch = mp.MaxPatch()
lfo = patch.place(cycle_tilde(1))[0]
switch = patch.place(thresh_tilde(0, 0.5))[0]   # 1 above 0.5, back to 0 below 0
edges = patch.place(edge_tilde)[0]
up = patch.place("message 660")[0]
down = patch.place("message 440")[0]
osc = patch.place(cycle_tilde(440))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (lfo.outs[0], switch.ins[0]),
    (switch.outs[0], edges.ins[0]),
    (edges.outs[0], up.ins[0]),       # 0 -> non-zero
    (edges.outs[1], down.ins[0]),     # non-zero -> 0
    (up.outs[0], osc.ins[0]),
    (down.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("edge_tilde")
