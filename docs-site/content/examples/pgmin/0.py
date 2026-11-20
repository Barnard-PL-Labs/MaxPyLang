"""Program changes pick the note
pgmin outputs the program number (1 to 128) when you choose a preset on your instrument. % 12 plus 60 turns it into a note. Play a MIDI keyboard's program or preset buttons to change the pitch; until then cycle~ holds middle C.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, mtof, pgmin

patch = mp.MaxPatch()
preset = patch.place(pgmin("a", 1))[0]   # port a, channel 1
fold = patch.place("% 12")[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde(262))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (preset.outs[0], fold.ins[0]),
    (fold.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("pgmin")
