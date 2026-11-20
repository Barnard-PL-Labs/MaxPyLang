"""Send to a name you can change
forward sends what it gets to every receive with its name, with no cord, and "send <name>" changes the name. Notes go to "low" (two octaves down) until you click the toggle, which forwards them to "high". Press ▶, then click the toggle.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, forward, metro, mtof, random, receive, select, toggle

patch = mp.MaxPatch()
flip = patch.place(toggle)[0]
which = patch.place(select(0, 1))[0]
to_low = patch.place("message send low")[0]
to_high = patch.place("message send high")[0]
clock = patch.place(metro(200, active=1))[0]
pick = patch.place(random(12))[0]
fwd = patch.place(forward("low"))[0]
low = patch.place(receive("low"))[0]
high = patch.place(receive("high"))[0]
down = patch.place("+ 48")[0]
up = patch.place("+ 72")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect((flip.outs[0], which.ins[0]), (which.outs[0], to_low.ins[0]), (which.outs[1], to_high.ins[0]),
              (to_low.outs[0], fwd.ins[0]), (to_high.outs[0], fwd.ins[0]),
              (clock.outs[0], pick.ins[0]), (pick.outs[0], fwd.ins[0]))
patch.connect((low.outs[0], down.ins[0]), (high.outs[0], up.ins[0]),   # no cord from fwd
              (down.outs[0], hz.ins[0]), (up.outs[0], hz.ins[0]), (hz.outs[0], osc.ins[0]),
              (osc.outs[0], quiet.ins[0]), (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]))
patch.save("forward")
