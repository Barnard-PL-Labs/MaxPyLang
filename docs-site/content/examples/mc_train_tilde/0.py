"""Two click tracks at once
mc.train~ makes one pulse train per channel. Periods of 250 and 333 ms put four clicks a second on the left against three on the right.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_ezdac_tilde, mc_train_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 250 333")[0]   # period in ms, per channel
clicks = patch.place(mc_train_tilde(250, 0.02))[0]   # 2% of each period on
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], clicks.ins[0]),
    (clicks.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_train")
