"""Recording to a file
sfrecord~ records audio to a sound file on disk. The message box opens take.aif to record into; click the toggle on to start and off to stop. You hear the sine as it records.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, loadbang, sfrecord_tilde, toggle

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
file = patch.place("message open take.aif")[0]
osc = patch.place(cycle_tilde(330))[0]
rec_on = patch.place(toggle)[0]
rec = patch.place(sfrecord_tilde(2))[0]       # 2 channels
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], file.ins[0]),
    (file.outs[0], rec.ins[0]),
    (rec_on.outs[0], rec.ins[0]),     # 1 starts, 0 stops
    (osc.outs[0], rec.ins[0]),
    (osc.outs[0], rec.ins[1]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("record_file")
