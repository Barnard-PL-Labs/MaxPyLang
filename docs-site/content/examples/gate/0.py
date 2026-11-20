"""Send notes one way or another
gate 2 1 has two outlets and starts with the first open: random notes go to + 60. The left inlet picks the outlet (0 closes it), so the toggle, plus 1, chooses outlet 1 or 2. Press ▶, then click the toggle to send the notes up an octave.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, gate, metro, mtof, random, toggle

patch = mp.MaxPatch()
flip = patch.place(toggle)[0]
which = patch.place("+ 1")[0]
clock = patch.place(metro(250, active=1))[0]
pick = patch.place(random(8))[0]
door = patch.place(gate(2, 1))[0]      # 2 outlets, outlet 1 open
low = patch.place("+ 60")[0]
high = patch.place("+ 72")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (flip.outs[0], which.ins[0]), (which.outs[0], door.ins[0]), (clock.outs[0], pick.ins[0]),
    (pick.outs[0], door.ins[1]), (door.outs[0], low.ins[0]), (door.outs[1], high.ins[0]),
    (low.outs[0], hz.ins[0]), (high.outs[0], hz.ins[0]), (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]), (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]),
)
patch.save("gate")
