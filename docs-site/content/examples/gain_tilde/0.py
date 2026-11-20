"""A fader for signals
gain~ is a fader that scales the signal passing through it and glides to each new level, so it never clicks. In Max it starts at 0, silent, so loadbang sets it to 120, a little below full level.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, gain_tilde, loadbang, saw_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
level = patch.place("message 120")[0]   # fader steps 0..157; about 128 is unchanged
saw = patch.place(saw_tilde(147))[0]
fader = patch.place(gain_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], level.ins[0]),
    (level.outs[0], fader.ins[0]),
    (saw.outs[0], fader.ins[0]),
    (fader.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("gain_tilde")
