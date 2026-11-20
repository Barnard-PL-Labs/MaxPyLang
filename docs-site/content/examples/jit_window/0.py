"""Show the camera in a window
jit.window displays frames; in Max it opens a window of its own outside the patch, and here it is drawn in the patch. Allow camera access, then press ▶ to see the camera.
"""
import maxpylang as mp
from maxpylang.objects import jit_grab, jit_window, loadbang, qmetro

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
open_ = patch.place("message open")[0]
clock = patch.place(qmetro(33, active=1))[0]
camera = patch.place(jit_grab)[0]
window = patch.place(jit_window)[0]

patch.connect(
    (start.outs[0], open_.ins[0]),
    (open_.outs[0], camera.ins[0]),
    (clock.outs[0], camera.ins[0]),
    (camera.outs[0], window.ins[0]),
)
patch.save("jit_window")
