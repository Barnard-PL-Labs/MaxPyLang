"""Playing a sound file from disk
sfplay~ plays a sound file straight from disk. The message box opens drumLoop.aif (it comes with Max) and turns looping on; click the toggle on to play and off to stop.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, loadbang, sfplay_tilde, toggle

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
file = patch.place("message open drumLoop.aif, loop 1")[0]
play_on = patch.place(toggle)[0]
player = patch.place(sfplay_tilde(2))[0]      # 2 channels
left = patch.place("*~ 0.3")[0]
right = patch.place("*~ 0.3")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], file.ins[0]),
    (file.outs[0], player.ins[0]),
    (play_on.outs[0], player.ins[0]),  # 1 plays, 0 stops
    (player.outs[0], left.ins[0]),
    (player.outs[1], right.ins[0]),
    (left.outs[0], out.ins[0]),
    (right.outs[0], out.ins[1]),
)
patch.save("play_file")
