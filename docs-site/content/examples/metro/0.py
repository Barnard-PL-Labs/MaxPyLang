"""A clock that plays notes
metro sends a bang every 250 ms. counter counts 0 to 7, + 60 turns that into MIDI notes, and mtof into hertz for cycle~.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]   # @active 1: starts on its own
step = patch.place(counter(0, 7))[0]
note = patch.place("+ 60")[0]                  # 60 is middle C
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("metro")
