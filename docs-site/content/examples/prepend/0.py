"""Build an envelope from a number
prepend puts its arguments in front of every message. The counter's 60 to 420 becomes "1 5 0 60" ... "1 5 0 420" for line~, so each strike rings a little longer than the last.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, line_tilde, metro, prepend

patch = mp.MaxPatch()
clock = patch.place(metro(450, active=1))[0]
step = patch.place(counter(1, 7))[0]
ms = patch.place("* 60")[0]
envelope = patch.place(prepend("1 5 0"))[0]   # 300 -> "1 5 0 300"
env = patch.place(line_tilde)[0]
osc = patch.place(cycle_tilde(440))[0]
amp = patch.place("*~ 0.")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], ms.ins[0]),
    (ms.outs[0], envelope.ins[0]),
    (envelope.outs[0], env.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("prepend")
