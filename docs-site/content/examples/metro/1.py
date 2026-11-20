"""Two clocks against each other
Two metros at 300 ms and 400 ms drift in and out of step, a 3-against-4 rhythm. Each picks a note for its own oscillator.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, mtof, random

patch = mp.MaxPatch()
fast = patch.place(metro(300, active=1))[0]
slow = patch.place(metro(400, active=1))[0]
pick_a = patch.place(random(5))[0]
pick_b = patch.place(random(5))[0]
note_a = patch.place("* 2")[0]
note_b = patch.place("* 3")[0]
up_a = patch.place("+ 64")[0]
up_b = patch.place("+ 52")[0]
hz_a = patch.place(mtof)[0]
hz_b = patch.place(mtof)[0]
osc_a = patch.place(cycle_tilde)[0]
osc_b = patch.place(cycle_tilde)[0]
mix = patch.place("+~")[0]
quiet = patch.place("*~ 0.15")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect((fast.outs[0], pick_a.ins[0]), (pick_a.outs[0], note_a.ins[0]),
              (note_a.outs[0], up_a.ins[0]), (up_a.outs[0], hz_a.ins[0]), (hz_a.outs[0], osc_a.ins[0]))
patch.connect((slow.outs[0], pick_b.ins[0]), (pick_b.outs[0], note_b.ins[0]),
              (note_b.outs[0], up_b.ins[0]), (up_b.outs[0], hz_b.ins[0]), (hz_b.outs[0], osc_b.ins[0]))
patch.connect((osc_a.outs[0], mix.ins[0]), (osc_b.outs[0], mix.ins[1]), (mix.outs[0], quiet.ins[0]),
              (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]))
patch.save("polyrhythm")
