"""A clock in beats per minute
tempo counts 0 to 7 in eighth notes at 60 BPM (its arguments: tempo, multiplier, division), once loadmess starts it. Each count, times 5, walks the notes around a circle of fourths. Press ▶, then type a new BPM into the number box.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, loadmess, mtof, number, tempo

patch = mp.MaxPatch()
start = patch.place(loadmess(1))[0]
bpm = patch.place(number)[0]
clock = patch.place(tempo(60, 1, 8))[0]
wrap = patch.place("% 8")[0]
fourths = patch.place("* 5")[0]
fold = patch.place("% 12")[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], clock.ins[0]),     # 1 starts it, 0 stops it
    (bpm.outs[0], clock.ins[1]), (clock.outs[0], wrap.ins[0]), (wrap.outs[0], fourths.ins[0]),
    (fourths.outs[0], fold.ins[0]), (fold.outs[0], note.ins[0]), (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]), (osc.outs[0], quiet.ins[0]), (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("tempo")
