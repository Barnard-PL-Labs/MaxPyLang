"""Pick a harmonic
radiogroup is a column of buttons of which one is on; clicking one sends its number, from 0 at the top. + 1 and * 110 turn 0..3 into 110, 220, 330 and 440 Hz, the first four harmonics of A. Press ▶, then click the radiogroup's buttons to step up the series.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde

patch = mp.MaxPatch()
# four buttons, in a box tall enough to show them (16 px each), in Max and here
choice = patch.place(mp.MaxObject("radiogroup", size=4, patching_rect=[0.0, 0.0, 18.0, 66.0]))[0]
harmonic = patch.place("+ 1")[0]
hz = patch.place("* 110")[0]
osc = patch.place(cycle_tilde(110))[0]     # the top button's note
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (choice.outs[0], harmonic.ins[0]),
    (harmonic.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("radiogroup")
