"""Notes from a MIDI keyboard
notein outputs the pitch and velocity of each key you play. Play a MIDI keyboard to change the pitch and loudness; until then cycle~ holds its 262 Hz (middle C) at a fixed level.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, mtof, notein

patch = mp.MaxPatch()
keys = patch.place(notein)[0]
hz = patch.place(mtof)[0]
level = patch.place("/ 127.")[0]
osc = patch.place(cycle_tilde(262))[0]
amp = patch.place("*~ 0.5")[0]        # until a velocity arrives
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (keys.outs[0], hz.ins[0]),         # pitch
    (keys.outs[1], level.ins[0]),      # velocity: 0 when the key is let go
    (hz.outs[0], osc.ins[0]),
    (level.outs[0], amp.ins[1]),
    (osc.outs[0], amp.ins[0]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("notein")
