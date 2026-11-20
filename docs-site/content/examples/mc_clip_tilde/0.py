"""Distortion on two channels
mc.*~ boosts two sines to 5 times their level, then mc.clip~ cuts every channel at -0.3 and 0.3. The flattened peaks sound gritty on both sides.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_clip_tilde, mc_cycle_tilde, mc_ezdac_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 196 294")[0]   # 2 channels
osc = patch.place(mc_cycle_tilde(196))[0]
boost = patch.place("mc.*~ 5")[0]
cut = patch.place(mc_clip_tilde(-0.3, 0.3))[0]
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], osc.ins[0]),
    (osc.outs[0], boost.ins[0]),
    (boost.outs[0], cut.ins[0]),
    (cut.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_clip")
