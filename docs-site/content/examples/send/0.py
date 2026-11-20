"""Messages without a cord
send passes messages to every receive with the same name ("notes"), anywhere in the patch, with no cord between them. Here a metro and counter play a melody into send, and a receive on the far side plays it.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, receive, send

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(0, 7))[0]
up = patch.place("+ 60")[0]
tx = patch.place(send("notes"))[0]
rx = patch.place(receive("notes"))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], up.ins[0]),
    (up.outs[0], tx.ins[0]),
    (rx.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("send")
