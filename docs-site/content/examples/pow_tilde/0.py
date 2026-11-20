"""Octaves into frequencies
pow~ 2 raises 2 to the power of the signal in its left inlet. A ramp climbs from 0 to 2 every two seconds; 2 to that power runs from 1 to 4, times 110 Hz: a sweep from 110 to 440 Hz, two octaves, that rises evenly in pitch. (A plain ramp of frequency would rush through the low octave and crawl through the high one.)
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, phasor_tilde, pow_tilde

patch = mp.MaxPatch()
ramp = patch.place(phasor_tilde(0.5))[0]      # 0 to 1, every two seconds
octaves = patch.place("*~ 2")[0]              # 0 to 2 octaves
power = patch.place(pow_tilde(2))[0]          # 2 to that power: 1 to 4
hz = patch.place("*~ 110")[0]                 # 110 to 440 Hz
osc = patch.place(cycle_tilde(0))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (ramp.outs[0], octaves.ins[0]),
    (octaves.outs[0], power.ins[0]),
    (power.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("pow_octaves")
