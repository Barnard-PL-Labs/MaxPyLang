"""Tremolo: audio times audio
Multiplying by a slow oscillator makes the volume pulse. A 4 Hz cycle~ goes into *~'s right inlet; it swings -1..1, so you hear 8 pulses a second.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde

patch = mp.MaxPatch()
osc = patch.place(cycle_tilde(330))[0]
lfo = patch.place(cycle_tilde(4))[0]     # 4 pulses a second
pulse = patch.place("*~ 0.")[0]          # times the LFO, from its right inlet
quiet = patch.place("*~ 0.2")[0]        # turn it down
out = patch.place(ezdac_tilde)[0]       # to both speakers

patch.connect(
    (osc.outs[0], pulse.ins[0]),
    (lfo.outs[0], pulse.ins[1]),
    (pulse.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("times_tilde")
