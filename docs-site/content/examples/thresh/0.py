"""Gathering notes into a chord
thresh collects numbers that arrive within 20 ms of each other into one list. Each beat, trigger sends three pitches at once (a major triad); thresh gathers them, and unpack plays them together on three sines. The triad steps up a semitone each beat.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, thresh, trigger, unpack

patch = mp.MaxPatch()
clock = patch.place(metro(600, active=1))[0]
root = patch.place(counter(57, 62))[0]
split = patch.place(trigger("i", "i", "i"))[0]
third = patch.place("+ 4")[0]
fifth = patch.place("+ 7")[0]
gather = patch.place(thresh(20))[0]           # numbers less than 20 ms apart become one list
notes = patch.place(unpack(0, 0, 0))[0]
hz = patch.place(mtof, num_objs=3)
osc = patch.place(cycle_tilde, num_objs=3)
mix = patch.place("*~ 0.1")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], root.ins[0]),
    (root.outs[0], split.ins[0]),
    (split.outs[2], gather.ins[0]),    # trigger fires right to left: root first
    (split.outs[1], third.ins[0]),
    (third.outs[0], gather.ins[0]),
    (split.outs[0], fifth.ins[0]),
    (fifth.outs[0], gather.ins[0]),
    (gather.outs[0], notes.ins[0]),
    (notes.outs[0], hz[0].ins[0]),
    (notes.outs[1], hz[1].ins[0]),
    (notes.outs[2], hz[2].ins[0]),
    (hz[0].outs[0], osc[0].ins[0]),
    (hz[1].outs[0], osc[1].ins[0]),
    (hz[2].outs[0], osc[2].ins[0]),
    (osc[0].outs[0], mix.ins[0]),
    (osc[1].outs[0], mix.ins[0]),
    (osc[2].outs[0], mix.ins[0]),
    (mix.outs[0], out.ins[0]),
    (mix.outs[0], out.ins[1]),
)
patch.save("thresh_chord")
