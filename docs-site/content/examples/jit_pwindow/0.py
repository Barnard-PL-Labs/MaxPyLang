"""A picture inside the patch
jit.pwindow draws each frame it receives inside the patch, and passes the frame on from its left outlet, so a second jit.pwindow can show it again further down. Allow camera access, then press ▶ to see the camera in both.
"""
import maxpylang as mp
from maxpylang.objects import jit_grab, jit_pwindow, loadbang, qmetro

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
open_ = patch.place("message open")[0]
clock = patch.place(qmetro(33, active=1))[0]
camera = patch.place(jit_grab)[0]
first = patch.place(jit_pwindow)[0]
second = patch.place(jit_pwindow)[0]

patch.connect(
    (start.outs[0], open_.ins[0]),
    (open_.outs[0], camera.ins[0]),
    (clock.outs[0], camera.ins[0]),
    (camera.outs[0], first.ins[0]),
    (first.outs[0], second.ins[0]),      # the frame passes through
)
patch.save("jit_pwindow")
