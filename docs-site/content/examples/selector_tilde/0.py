"""Let a signal through, or not
selector~ 1 1 has one signal input, open to start; its left inlet picks which input to pass, and 0 picks none. Press ▶, then click the toggle on and off: off sends 0 and the tone stops, on sends 1 and it returns.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, selector_tilde, toggle

patch = mp.MaxPatch()
switch = patch.place(toggle)[0]
osc = patch.place(cycle_tilde(294))[0]
choose = patch.place(selector_tilde(1, 1))[0]   # 1 input, input 1 open
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (switch.outs[0], choose.ins[0]),
    (osc.outs[0], choose.ins[1]),
    (choose.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("selector_tilde")
