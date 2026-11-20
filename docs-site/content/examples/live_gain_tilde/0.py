"""A Live volume fader
live.gain~ is the fader Max for Live devices use: it scales a stereo signal by a level in dB and shows the meter. loadbang sets it to 0 dB (full level) when the patch opens. Press ▶, then drag the fader down to fade the chord out.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, live_gain_tilde, loadbang

patch = mp.MaxPatch()
low = patch.place(cycle_tilde(220))[0]
high = patch.place(cycle_tilde(277))[0]
start = patch.place(loadbang)[0]
level = patch.place("message 0")[0]          # 0 dB: full level
fader = patch.place(live_gain_tilde)[0]      # inlets: left and right audio (left also takes a level)
quiet_l = patch.place("*~ 0.2")[0]
quiet_r = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], level.ins[0]),
    (level.outs[0], fader.ins[0]),
    (low.outs[0], fader.ins[0]),
    (high.outs[0], fader.ins[1]),
    (fader.outs[0], quiet_l.ins[0]),
    (fader.outs[1], quiet_r.ins[0]),
    (quiet_l.outs[0], out.ins[0]),
    (quiet_r.outs[0], out.ins[1]),
)
patch.save("live_gain")
