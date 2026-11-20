"""Start-up values
loadmess sends its message once, when the patch starts. One sends 220 to cycle~ for the pitch; the other sends "1 3000" to line~, so the tone fades in over 3 seconds.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, line_tilde, loadmess

patch = mp.MaxPatch()
pitch = patch.place(loadmess(220))[0]
fade = patch.place("loadmess 1 3000")[0]   # to 1, over 3000 ms
osc = patch.place(cycle_tilde)[0]
env = patch.place(line_tilde)[0]
amp = patch.place("*~ 0.")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (pitch.outs[0], osc.ins[0]),
    (fade.outs[0], env.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("loadmess")
