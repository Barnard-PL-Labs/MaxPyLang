"""Bangs in a fixed order
bangbang sends a bang out each outlet, right to left, whatever comes in. The right bang picks the note first, then the left bang starts the pluck, so every pluck has its new pitch.
"""
import maxpylang as mp
from maxpylang.objects import bangbang, cycle_tilde, ezdac_tilde, line_tilde, metro, mtof, random

patch = mp.MaxPatch()
clock = patch.place(metro(300, active=1))[0]
both = patch.place(bangbang)[0]
pick = patch.place(random(12))[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
pluck = patch.place("message 1 5 0 280")[0]
env = patch.place(line_tilde)[0]
osc = patch.place(cycle_tilde)[0]
amp = patch.place("*~ 0.")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], both.ins[0]),
    (both.outs[1], pick.ins[0]),       # right: first
    (pick.outs[0], note.ins[0]), (note.outs[0], hz.ins[0]), (hz.outs[0], osc.ins[0]),
    (both.outs[0], pluck.ins[0]),      # left: second
    (pluck.outs[0], env.ins[0]), (osc.outs[0], amp.ins[0]), (env.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]), (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]),
)
patch.save("bangbang")
