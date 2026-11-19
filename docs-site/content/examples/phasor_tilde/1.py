"""A rising sweep
A slow phasor~ (0.5 Hz) is a ramp you can use as a control: here it sweeps a cycle~ from 200 to 1000 Hz every two seconds.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, phasor_tilde

patch = mp.MaxPatch()
ramp = patch.place(phasor_tilde(0.5))[0]
span = patch.place("*~ 800")[0]
low = patch.place("+~ 200")[0]
osc = patch.place(cycle_tilde(0))[0]     # 0: the frequency comes from the signal
quiet = patch.place("*~ 0.2")[0]        # turn it down
out = patch.place(ezdac_tilde)[0]       # to both speakers

patch.connect(
    (ramp.outs[0], span.ins[0]),
    (span.outs[0], low.ins[0]),
    (low.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("phasor_tilde")
