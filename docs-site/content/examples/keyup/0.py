"""Hold a key for a higher note
keyup sends a key's code when you let go of it, where key sends it when you press. Pressing any key sends 440 to cycle~ and letting go sends 220. Press ▶, then hold down any key on your keyboard and release it.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, key, keyup

patch = mp.MaxPatch()
down = patch.place(key)[0]
up = patch.place(keyup)[0]
high = patch.place("message 440")[0]
low = patch.place("message 220")[0]
osc = patch.place(cycle_tilde(220))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (down.outs[0], high.ins[0]),         # any message makes a message box send
    (up.outs[0], low.ins[0]),
    (high.outs[0], osc.ins[0]),
    (low.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("keyup")
