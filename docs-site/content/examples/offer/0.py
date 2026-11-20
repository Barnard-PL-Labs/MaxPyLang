"""Notes you can only take once
offer stores x, y pairs and hands back y when it receives x, then deletes the pair. A counter runs 0 to 11. For the first four beats it quietly stores the pairs 0 60, 1 64, 2 68 and 3 72; for the next four it asks for 0 to 3 and you hear four rising plucks; for the last four it asks again, but the pairs are gone, so offer sends nothing and you hear silence.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, line_tilde, metro, mtof, offer, split, trigger

patch = mp.MaxPatch()
clock = patch.place(metro(300, active=1))[0]
step = patch.place(counter(0, 11))[0]
store_or_ask = patch.place(split(0, 3))[0]    # 0-3 out the left, 4-11 out the right
xy = patch.place(trigger("i", "i"))[0]
spread = patch.place("* 4")[0]
pitch = patch.place("+ 60")[0]
ask = patch.place("% 4")[0]
once = patch.place(offer)[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
shape = patch.place("message 1 5 0 250")[0]
env = patch.place(line_tilde)[0]
amp = patch.place("*~ 0.")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], store_or_ask.ins[0]),
    (store_or_ask.outs[0], xy.ins[0]),
    (xy.outs[1], spread.ins[0]),       # trigger fires right to left: y first
    (spread.outs[0], pitch.ins[0]),
    (pitch.outs[0], once.ins[1]),
    (xy.outs[0], once.ins[0]),         # then x: the pair is stored, nothing comes out
    (store_or_ask.outs[1], ask.ins[0]),
    (ask.outs[0], once.ins[0]),        # x alone: y comes out once, then the pair is gone
    (once.outs[0], hz.ins[0]),
    (once.outs[0], shape.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (shape.outs[0], env.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("offer")
