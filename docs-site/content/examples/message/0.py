"""Click a message to change the note
A message box sends what it says when you click it. These three send 262, 330 and 392, the hertz of C, E and G, to cycle~. Press ▶, then click the message boxes to play a chord one note at a time.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde

patch = mp.MaxPatch()
c = patch.place("message 262")[0]
e = patch.place("message 330")[0]
g = patch.place("message 392")[0]
osc = patch.place(cycle_tilde(262))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (c.outs[0], osc.ins[0]),
    (e.outs[0], osc.ins[0]),
    (g.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("message")
