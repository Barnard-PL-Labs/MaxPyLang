"""From period to pitch
mc.rdiv~ divides its argument by each channel, the reverse of mc.div~. 1 divided by periods of 0.005 and 0.004 seconds gives 200 and 250 Hz.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_rdiv_tilde, mc_sig_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
periods = patch.place("message chans 2, applyvalues 0.005 0.004")[0]   # seconds per cycle
period = patch.place(mc_sig_tilde(0.005))[0]
hz = patch.place(mc_rdiv_tilde(1))[0]       # 1 / signal
osc = patch.place(mc_cycle_tilde(0))[0]     # 0: the frequency comes from the signal
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], periods.ins[0]),
    (periods.outs[0], period.ins[0]),
    (period.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_rdiv")
