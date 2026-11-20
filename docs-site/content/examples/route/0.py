"""Sort messages by their first word
route looks at a message's first word, strips it, and sends the rest out the matching outlet. Notes tagged "bass" play low (+ 36) and notes tagged "lead" high (+ 72), each on its own oscillator.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, mtof, prepend, random, route

patch = mp.MaxPatch()
slow = patch.place(metro(500, active=1))[0]
fast = patch.place(metro(250, active=1))[0]
pick_a = patch.place(random(8))[0]
pick_b = patch.place(random(8))[0]
tag_a = patch.place(prepend("bass"))[0]
tag_b = patch.place(prepend("lead"))[0]
sort = patch.place(route("bass", "lead"))[0]
low = patch.place("+ 36")[0]
high = patch.place("+ 72")[0]
hz_a = patch.place(mtof)[0]
hz_b = patch.place(mtof)[0]
osc_a = patch.place(cycle_tilde)[0]
osc_b = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.15")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect((slow.outs[0], pick_a.ins[0]), (pick_a.outs[0], tag_a.ins[0]), (tag_a.outs[0], sort.ins[0]),
              (fast.outs[0], pick_b.ins[0]), (pick_b.outs[0], tag_b.ins[0]), (tag_b.outs[0], sort.ins[0]),
              (sort.outs[0], low.ins[0]), (low.outs[0], hz_a.ins[0]), (hz_a.outs[0], osc_a.ins[0]),
              (sort.outs[1], high.ins[0]), (high.outs[0], hz_b.ins[0]), (hz_b.outs[0], osc_b.ins[0]),
              (osc_a.outs[0], quiet.ins[0]), (osc_b.outs[0], quiet.ins[0]),   # signals into one inlet add
              (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]))
patch.save("route")
