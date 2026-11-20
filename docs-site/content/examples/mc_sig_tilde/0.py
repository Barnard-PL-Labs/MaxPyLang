"""Constant signals, one per channel
mc.sig~ turns numbers into steady signals, one per channel: 220 and 277. Into mc.cycle~'s left inlet they set each channel's frequency, a major third.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_sig_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 220 277")[0]   # 2 channels
freq = patch.place(mc_sig_tilde(220))[0]
osc = patch.place(mc_cycle_tilde(0))[0]     # 0: the frequency comes from the signal
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], freq.ins[0]),
    (freq.outs[0], osc.ins[0]),             # osc adapts to 2 channels
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_sig")
