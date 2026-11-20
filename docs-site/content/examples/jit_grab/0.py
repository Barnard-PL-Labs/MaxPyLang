"""Your camera in the patch
jit.grab reads frames from a camera. In Max it needs an "open" message to start the camera and a bang for each frame, which qmetro sends 30 times a second; jit.pwindow shows the frames. Allow camera access, then press ▶ to see yourself.
"""
import maxpylang as mp
from maxpylang.objects import jit_grab, jit_pwindow, loadbang, qmetro

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
open_ = patch.place("message open")[0]     # turn the camera on
clock = patch.place(qmetro(33, active=1))[0]   # one frame every 33 ms
camera = patch.place(jit_grab)[0]
screen = patch.place(jit_pwindow)[0]

patch.connect(
    (start.outs[0], open_.ins[0]),
    (open_.outs[0], camera.ins[0]),
    (clock.outs[0], camera.ins[0]),
    (camera.outs[0], screen.ins[0]),
)
patch.save("jit_grab")
