"""Fade the camera to grey
jit.scalebias multiplies each colour by its scale, then adds its bias (colours run 0 to 1): rscale, gscale and bscale 0.5 halve the contrast, and rbias, gbias and bbias 0.25 lift the darks, so the picture looks washed out. (Its plain scale and bias apply only in channel-summing mode, mode 1.) Allow camera access, then press ▶.
"""
import maxpylang as mp
from maxpylang.objects import jit_grab, jit_pwindow, jit_scalebias, loadbang, qmetro

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
open_ = patch.place("message open")[0]
clock = patch.place(qmetro(33, active=1))[0]
camera = patch.place(jit_grab)[0]
fade = patch.place(jit_scalebias(rscale=0.5, gscale=0.5, bscale=0.5,
                                 rbias=0.25, gbias=0.25, bbias=0.25))[0]   # each colour: 0.5 * in + 0.25
screen = patch.place(jit_pwindow)[0]

patch.connect(
    (start.outs[0], open_.ins[0]),
    (open_.outs[0], camera.ins[0]),
    (clock.outs[0], camera.ins[0]),
    (camera.outs[0], fade.ins[0]),
    (fade.outs[0], screen.ins[0]),
)
patch.save("jit_scalebias")
