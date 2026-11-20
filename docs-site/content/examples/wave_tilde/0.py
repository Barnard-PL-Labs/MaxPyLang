"""A wavetable from a recording
wave~ reads a stretch of a buffer~, from its start to its end point in ms, at a phase from 0 to 1. Here the stretch is 10 ms of the drum loop, from 100 to 110 ms, and phasor~ sweeps through it 110 times a second: a buzzy tone at 110 Hz whose colour comes from the drum. drumLoop.aif comes with Max; on this page a CC0 drum loop stands in for it.
"""
import maxpylang as mp
from maxpylang.objects import buffer_tilde, ezdac_tilde, phasor_tilde, wave_tilde

patch = mp.MaxPatch()
table = patch.place(buffer_tilde("drums", "drumLoop.aif"))[0]
ramp = patch.place(phasor_tilde(110))[0]              # 0 to 1, 110 times a second
read = patch.place(wave_tilde("drums", 100, 110))[0]   # start, end (ms)
quiet = patch.place("*~ 0.3")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (ramp.outs[0], read.ins[0]),
    (read.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("wavetable")
