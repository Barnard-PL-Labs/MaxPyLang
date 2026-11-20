"""Overdrive on every channel
mc.overdrive~ distorts each channel the same way: a drive of 4 squares off two low sines, 110 and 165 Hz, into a buzzy fifth.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_overdrive_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 110 165")[0]
osc = patch.place(mc_cycle_tilde(110))[0]
drive = patch.place(mc_overdrive_tilde(4))[0]   # 1 is clean; higher is harsher
quiet = patch.place("mc.*~ 0.1")[0]
out = patch.place(mc_ezdac_tilde)[0]

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], osc.ins[0]),
    (osc.outs[0], drive.ins[0]),
    (drive.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_overdrive")
