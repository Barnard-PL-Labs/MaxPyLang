"""One fader for every channel
mc.gain~ is a volume slider for a multichannel signal: one fader sets the level of both tones. loadbang sets it to 128, full volume; drag it down to fade.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_gain_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 294 440")[0]   # 2 channels
level = patch.place("message 128")[0]       # 128 is full volume, 0 is silent
osc = patch.place(mc_cycle_tilde(294))[0]
fader = patch.place(mc_gain_tilde)[0]
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (start.outs[0], level.ins[0]),
    (voices.outs[0], osc.ins[0]),
    (level.outs[0], fader.ins[0]),
    (osc.outs[0], fader.ins[0]),
    (fader.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_gain")
