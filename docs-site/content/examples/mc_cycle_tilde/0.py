"""Two sines from one box
mc.cycle~ holds one cycle~ per channel. loadbang asks for 2 channels and gives each its own frequency, so one box plays 220 Hz on the left and 330 Hz on the right.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_ezdac_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 220 330")[0]   # 2 channels, one value each
osc = patch.place(mc_cycle_tilde(220))[0]   # 220 for any channel not given a value
quiet = patch.place("mc.*~ 0.2")[0]         # turns down every channel
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_cycle")
