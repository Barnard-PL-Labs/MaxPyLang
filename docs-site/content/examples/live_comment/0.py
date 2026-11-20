"""A label in a Live device
live.comment is a text label in a Max for Live device, shown in Live. Here it labels the gain slider of a simple audio effect: a track's sound comes in through plugin~, passes the slider, and goes back out through plugout~.
"""
import maxpylang as mp
from maxpylang.objects import live_comment, live_gain_tilde, plugin_tilde, plugout_tilde

patch = mp.MaxPatch()
label = patch.place(live_comment)[0]
src = patch.place(plugin_tilde)[0]
level = patch.place(live_gain_tilde)[0]
dst = patch.place(plugout_tilde)[0]

patch.connect(
    (src.outs[0], level.ins[0]),
    (src.outs[1], level.ins[1]),
    (level.outs[0], dst.ins[0]),
    (level.outs[1], dst.ins[1]),
)
patch.save("labelled_device")
