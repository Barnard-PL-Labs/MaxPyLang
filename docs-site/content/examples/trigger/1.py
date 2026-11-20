"""t: pick the octave first
t is short for trigger. "t i b" bangs its right outlet first: random picks 0 or 12 into the cold right inlet of +, and only then the note arrives at the hot left inlet. So the melody jumps octaves at random, never a beat late.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, random

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(60, 67))[0]
order = patch.place("t i b")[0]
coin = patch.place(random(2))[0]
octave = patch.place("* 12")[0]
note = patch.place("+ 0")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]), (step.outs[0], order.ins[0]),
    (order.outs[1], coin.ins[0]),      # right outlet fires first
    (coin.outs[0], octave.ins[0]),
    (octave.outs[0], note.ins[1]),     # cold: stored, no output
    (order.outs[0], note.ins[0]),      # hot: adds and outputs
    (note.outs[0], hz.ins[0]), (hz.outs[0], osc.ins[0]), (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]),
)
patch.save("t")
