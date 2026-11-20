"""A black-and-white camera
jit.brcosa changes a picture's brightness, contrast and saturation; 1 leaves each one as it is. Here saturation 0 takes out the colour and contrast 1.5 makes it punchier. Allow camera access, then press ▶.
"""
import maxpylang as mp
from maxpylang.objects import jit_brcosa, jit_grab, jit_pwindow, loadbang, qmetro

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
open_ = patch.place("message open")[0]
clock = patch.place(qmetro(33, active=1))[0]
camera = patch.place(jit_grab)[0]
grade = patch.place(jit_brcosa(brightness=1.1, contrast=1.5, saturation=0))[0]
screen = patch.place(jit_pwindow)[0]

patch.connect(
    (start.outs[0], open_.ins[0]),
    (open_.outs[0], camera.ins[0]),
    (clock.outs[0], camera.ins[0]),
    (camera.outs[0], grade.ins[0]),
    (grade.outs[0], screen.ins[0]),
)
patch.save("jit_brcosa")
