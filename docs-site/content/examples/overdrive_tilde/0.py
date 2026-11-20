"""Warm distortion
overdrive~ bends a signal's waveform the way an overdriven amplifier does; its argument is the drive (1 is clean). A 110 Hz sine driven to 6 sounds buzzy and full. Press ▶, then drag the number box to change the drive.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, number, overdrive_tilde

patch = mp.MaxPatch()
osc = patch.place(cycle_tilde(110))[0]
amount = patch.place(number)[0]
fuzz = patch.place(overdrive_tilde(6))[0]     # drive 6 until you change the number
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (osc.outs[0], fuzz.ins[0]),
    (amount.outs[0], fuzz.ins[1]),
    (fuzz.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("overdrive")
