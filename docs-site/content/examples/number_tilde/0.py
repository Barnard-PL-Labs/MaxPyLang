"""A ramp read out as notes
number~ shows a signal's value and sends it out its right outlet as a number, ten times a second. Reading phasor~'s slow 0..1 ramp, those numbers become a pitch that climbs in steps from 200 to 600 Hz every two seconds.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, number_tilde, phasor_tilde

patch = mp.MaxPatch()
ramp = patch.place(phasor_tilde(0.5))[0]   # 0..1 every 2 seconds
show = patch.place(number_tilde)[0]
span = patch.place("* 400.")[0]
hz = patch.place("+ 200.")[0]              # 200..600 Hz
osc = patch.place(cycle_tilde(200))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (ramp.outs[0], show.ins[0]),
    (show.outs[1], span.ins[0]),           # right outlet: the value as a number
    (span.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("number_tilde")
