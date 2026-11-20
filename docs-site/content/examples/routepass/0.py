"""Let only some notes through
routepass is route that keeps the matched word: 60, 64 or 67 comes out whole (route would send only a bang). The counter climbs a semitone at a time, and only the notes of a C major chord reach the oscillator.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, routepass

patch = mp.MaxPatch()
clock = patch.place(metro(150, active=1))[0]
climb = patch.place(counter(60, 71))[0]
chord = patch.place(routepass(60, 64, 67))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], climb.ins[0]),
    (climb.outs[0], chord.ins[0]),
    (chord.outs[0], hz.ins[0]),
    (chord.outs[1], hz.ins[0]),
    (chord.outs[2], hz.ins[0]),        # outs[3], the other notes, goes nowhere
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("routepass")
