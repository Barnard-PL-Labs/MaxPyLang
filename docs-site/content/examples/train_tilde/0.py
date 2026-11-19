"""A click track
train~ outputs a pulse train: 1 for part of each period and 0 for the rest. A 250 ms period gives four clicks a second.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, train_tilde

patch = mp.MaxPatch()
clicks = patch.place(train_tilde(250, 0.02))[0]   # period 250 ms, 2% on
quiet = patch.place("*~ 0.2")[0]        # turn it down
out = patch.place(ezdac_tilde)[0]       # to both speakers

patch.connect(
    (clicks.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("train_tilde")
