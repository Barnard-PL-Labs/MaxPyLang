"""Looping a sound file
buffer~ loads a sound file into memory under a name, here drums; any object that names drums can play it. groove~ loops it at normal speed (a signal of 1). drumLoop.aif comes with Max.
"""
import maxpylang as mp
from maxpylang.objects import buffer_tilde, ezdac_tilde, groove_tilde, sig_tilde

patch = mp.MaxPatch()
drums = patch.place(buffer_tilde("drums", "drumLoop.aif"))[0]
speed = patch.place(sig_tilde(1))[0]          # 1 = normal speed
player = patch.place(groove_tilde("drums", loop=1))[0]
quiet = patch.place("*~ 0.3")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (speed.outs[0], player.ins[0]),
    (player.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("drum_loop")
