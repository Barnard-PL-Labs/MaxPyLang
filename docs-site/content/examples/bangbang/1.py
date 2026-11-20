"""b: flip a coin, then play
b is short for bangbang. Its right bang asks decide for a 0 or 1, which closes or opens the gate; then its left bang sends a random note at the gate. About half the beats, the note doesn't change.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, decide, ezdac_tilde, gate, metro, mtof, random

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
both = patch.place("b")[0]
coin = patch.place(decide)[0]
door = patch.place(gate(1, 1))[0]
pick = patch.place(random(12))[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], both.ins[0]), (both.outs[1], coin.ins[0]),
    (coin.outs[0], door.ins[0]),       # 0 shuts the gate, 1 opens it
    (both.outs[0], pick.ins[0]), (pick.outs[0], door.ins[1]), (door.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]), (hz.outs[0], osc.ins[0]), (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]),
)
patch.save("b")
