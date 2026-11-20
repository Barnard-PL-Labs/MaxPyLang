"""Choosing an input
mc.selector~ passes the multichannel input whose number its left inlet gets, or silence for 0. With one input, counter's 0, 1, 0, 1 turns two sawtooths off and on every 300 ms.
"""
import maxpylang as mp
from maxpylang.objects import counter, loadbang, mc_ezdac_tilde, mc_saw_tilde, mc_selector_tilde, metro

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 110 220")[0]   # 2 channels
saw = patch.place(mc_saw_tilde(110))[0]
clock = patch.place(metro(300, active=1))[0]
choose = patch.place(counter(0, 1))[0]      # 0 = none, 1 = input 1
pick = patch.place(mc_selector_tilde(1, 0))[0]   # 1 input, none chosen at first
quiet = patch.place("mc.*~ 0.15")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], saw.ins[0]),
    (clock.outs[0], choose.ins[0]),
    (choose.outs[0], pick.ins[0]),
    (saw.outs[0], pick.ins[1]),
    (pick.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_selector")
