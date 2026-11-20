"""Too loud, made safe
Two sines boosted to 4 times full scale would distort. mc.limi~ is a limiter on every channel: it turns each one down just enough to stay within -1..1.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_limi_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 262 330")[0]   # 2 channels
osc = patch.place(mc_cycle_tilde(262))[0]
boost = patch.place("mc.*~ 4")[0]           # far too loud
safe = patch.place(mc_limi_tilde)[0]
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], osc.ins[0]),
    (osc.outs[0], boost.ins[0]),
    (boost.outs[0], safe.ins[0]),
    (safe.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_limi")
