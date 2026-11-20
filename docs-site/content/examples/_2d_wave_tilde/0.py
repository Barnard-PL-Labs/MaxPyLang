"""A tone that morphs between slices of a recording
2d.wave~ splits a stretch of a buffer~ into rows and reads one row like wave~ does: X, from phasor~, is the place in the row, and Y picks the row. Here 80 ms of the drum loop becomes 8 rows of 10 ms, X sweeps a row 110 times a second, and a slow sine moves Y up and down, so a 110 Hz tone morphs through the drum's colours. drumLoop.aif comes with Max; on this page a CC0 drum loop stands in for it.
"""
import maxpylang as mp
from maxpylang.objects import _2d_wave_tilde, buffer_tilde, cycle_tilde, ezdac_tilde, phasor_tilde

patch = mp.MaxPatch()
table = patch.place(buffer_tilde("drums", "drumLoop.aif"))[0]
x = patch.place(phasor_tilde(110))[0]                    # place in the row, 110 times a second
lfo = patch.place(cycle_tilde(0.2))[0]
depth = patch.place("*~ 0.5")[0]
y = patch.place("+~ 0.5")[0]                             # which row: 0 to 1, every 5 seconds
read = patch.place(_2d_wave_tilde("drums", 0, 80, 1, 8))[0]   # start, end (ms), channels, rows
quiet = patch.place("*~ 0.3")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (x.outs[0], read.ins[0]),
    (lfo.outs[0], depth.ins[0]),
    (depth.outs[0], y.ins[0]),
    (y.outs[0], read.ins[1]),
    (read.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("wave2d")
