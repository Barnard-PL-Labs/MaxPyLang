"""Speeding a loop up and down
groove~ plays a buffer~ at the speed of the signal in its left inlet: 1 is normal, 2 is twice as fast and an octave up. A slow sine swings the speed between 0.5 and 1.5 every four seconds, so the loop drags and rushes. drumLoop.aif comes with Max; on this page a CC0 drum loop stands in for it.
"""
import maxpylang as mp
from maxpylang.objects import buffer_tilde, cycle_tilde, ezdac_tilde, groove_tilde

patch = mp.MaxPatch()
drums = patch.place(buffer_tilde("drums", "drumLoop.aif"))[0]
lfo = patch.place(cycle_tilde(0.25))[0]
depth = patch.place("*~ 0.5")[0]
centre = patch.place("+~ 1")[0]                       # speed 0.5 to 1.5
player = patch.place(groove_tilde("drums", loop=1))[0]
quiet = patch.place("*~ 0.3")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (lfo.outs[0], depth.ins[0]),
    (depth.outs[0], centre.ins[0]),
    (centre.outs[0], player.ins[0]),
    (player.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("groove_speed")
