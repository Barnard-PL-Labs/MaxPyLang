"""Scanning a sample on many channels
mc.2d.wave~ reads a buffer~ as a table, at positions from 0 to 1 that a ramp sweeps through. Two ramps, 2 and 3 times a second, loop slices of drumLoop.aif (it comes with Max) at two speeds.
"""
import maxpylang as mp
from maxpylang.objects import buffer_tilde, loadbang, mc_2d_wave_tilde, mc_ezdac_tilde, mc_phasor_tilde

patch = mp.MaxPatch()
table = patch.place(buffer_tilde("drums", "drumLoop.aif"))[0]
start = patch.place(loadbang)[0]
speeds = patch.place("message chans 2, applyvalues 2 3")[0]
ramp = patch.place(mc_phasor_tilde(2))[0]
scan = patch.place(mc_2d_wave_tilde("drums"))[0]
quiet = patch.place("mc.*~ 0.3")[0]
out = patch.place(mc_ezdac_tilde)[0]

patch.connect(
    (start.outs[0], speeds.ins[0]),
    (speeds.outs[0], ramp.ins[0]),
    (ramp.outs[0], scan.ins[0]),
    (scan.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_scan")
