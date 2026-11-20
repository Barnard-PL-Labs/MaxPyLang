"""Pixelate the camera
jit.matrix holds a picture of a fixed size. Copying the camera into one only 40 by 30 pixels big, then showing it full size in jit.pwindow, makes big square pixels. Allow camera access, then press ▶ and wave at the camera.
"""
import maxpylang as mp
from maxpylang.objects import jit_grab, jit_matrix, jit_pwindow, loadbang, qmetro

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
open_ = patch.place("message open")[0]
clock = patch.place(qmetro(33, active=1))[0]
camera = patch.place(jit_grab)[0]
small = patch.place(jit_matrix(4, "char", 40, 30))[0]   # 4 planes of char, 40 x 30 pixels
screen = patch.place(jit_pwindow)[0]

patch.connect(
    (start.outs[0], open_.ins[0]),
    (open_.outs[0], camera.ins[0]),
    (clock.outs[0], camera.ins[0]),
    (camera.outs[0], small.ins[0]),
    (small.outs[0], screen.ins[0]),
)
patch.save("jit_matrix")
