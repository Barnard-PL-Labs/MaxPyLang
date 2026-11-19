"""Attack, decay, sustain, release
adsr~ makes a classic note envelope. A number above 0 starts the note at that level; 0 releases it. counter alternates 1 and 0, so the note holds for 600 ms, then fades.
"""
import maxpylang as mp
from maxpylang.objects import adsr_tilde, counter, ezdac_tilde, metro, saw_tilde

patch = mp.MaxPatch()
clock = patch.place(metro(600, active=1))[0]
gate = patch.place(counter(0, 1))[0]               # 0, 1, 0, 1, ...
env = patch.place(adsr_tilde(10, 150, 0.5, 300))[0]  # attack, decay ms, sustain level, release ms
osc = patch.place(saw_tilde(110))[0]
amp = patch.place("*~ 0.")[0]              # times the envelope (silent until it rises)
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], gate.ins[0]),
    (gate.outs[0], env.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("adsr")
