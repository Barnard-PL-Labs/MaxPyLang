"""A chord as an arpeggio
iter sends the items of a list out one at a time. pipe holds each note longer the higher it is, 40 ms per semitone above 60, so the chord plays as a rising arpeggio. Press ▶, then change the number box to spread the notes out.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, iter_, metro, mtof, number, pipe, trigger

patch = mp.MaxPatch()
clock = patch.place(metro(1000, active=1))[0]
chord = patch.place("message 60 64 67 72")[0]
each = patch.place(iter_)[0]
order = patch.place(trigger("i", "i"))[0]   # set the delay, then send the note
above = patch.place("- 60")[0]
spacing = patch.place("* 40")[0]
gap = patch.place(number)[0]             # milliseconds per semitone
later = patch.place(pipe(0))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], chord.ins[0]),
    (chord.outs[0], each.ins[0]),
    (each.outs[0], order.ins[0]),
    (order.outs[1], above.ins[0]),
    (above.outs[0], spacing.ins[0]),
    (gap.outs[0], spacing.ins[1]),
    (spacing.outs[0], later.ins[1]),   # delay: 0, 160, 280, 480 ms
    (order.outs[0], later.ins[0]),
    (later.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("iter")
