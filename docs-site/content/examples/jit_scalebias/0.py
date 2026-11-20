"""Fade the camera to grey
jit.scalebias multiplies every pixel by scale, then adds bias. Scale 0.5 halves the contrast and bias 0.25 lifts the darks, so the picture looks washed out. Allow camera access, then press ▶.
"""
import maxpylang as mp
from maxpylang.objects import jit_grab, jit_pwindow, jit_scalebias, loadbang, qmetro

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
open_ = patch.place("message open")[0]
clock = patch.place(qmetro(33, active=1))[0]
camera = patch.place(jit_grab)[0]
fade = patch.place(jit_scalebias(scale=0.5, bias=0.25))[0]   # out = 0.5 * in + 0.25
screen = patch.place(jit_pwindow)[0]

patch.connect(
    (start.outs[0], open_.ins[0]),
    (open_.outs[0], camera.ins[0]),
    (clock.outs[0], camera.ins[0]),
    (camera.outs[0], fade.ins[0]),
    (fade.outs[0], screen.ins[0]),
)
patch.save("jit_scalebias")
