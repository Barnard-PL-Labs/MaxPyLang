"""A level slider for many channels
mc.live.gain~ is Live's gain slider and meter, for a multichannel signal: drag it to set the level of both tones at once, in dB.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_live_gain_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 220 330")[0]
osc = patch.place(mc_cycle_tilde(220))[0]
quiet = patch.place("mc.*~ 0.2")[0]
level = patch.place(mc_live_gain_tilde)[0]
out = patch.place(mc_ezdac_tilde)[0]

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], level.ins[0]),
    (level.outs[0], out.ins[0]),
)
patch.save("mc_level")
