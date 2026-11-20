"""Messages without a cord
receive outputs whatever is sent to its name from anywhere in the patch, with no cord. Here forward sends each note to "note", and two receives turn it into a root and a fifth on two oscillators.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, forward, metro, mtof, receive

patch = mp.MaxPatch()
clock = patch.place(metro(300, active=1))[0]
step = patch.place(counter(48, 55))[0]
tx = patch.place(forward("note"))[0]
root = patch.place(receive("note"))[0]
other = patch.place(receive("note"))[0]
fifth = patch.place("+ 7")[0]
hz_a = patch.place(mtof)[0]
hz_b = patch.place(mtof)[0]
osc_a = patch.place(cycle_tilde)[0]
osc_b = patch.place(cycle_tilde)[0]
mix = patch.place("+~")[0]
quiet = patch.place("*~ 0.15")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect((clock.outs[0], step.ins[0]), (step.outs[0], tx.ins[0]))
patch.connect((root.outs[0], hz_a.ins[0]), (hz_a.outs[0], osc_a.ins[0]),
              (other.outs[0], fifth.ins[0]), (fifth.outs[0], hz_b.ins[0]), (hz_b.outs[0], osc_b.ins[0]),
              (osc_a.outs[0], mix.ins[0]), (osc_b.outs[0], mix.ins[1]), (mix.outs[0], quiet.ins[0]),
              (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]))
patch.save("receive")
