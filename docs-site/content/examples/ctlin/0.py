"""A knob on your controller
ctlin outputs the value (0 to 127) of any knob, fader or mod wheel you move. Play a MIDI keyboard's mod wheel, or turn a knob, to open and close the filter on this buzzing saw~; until then lores~ holds it at 600 Hz.
"""
import maxpylang as mp
from maxpylang.objects import ctlin, ezdac_tilde, lores_tilde, saw_tilde, scale

patch = mp.MaxPatch()
knob = patch.place(ctlin)[0]
cutoff = patch.place(scale(0, 127, 200, 4000))[0]
buzz = patch.place(saw_tilde(110))[0]
filt = patch.place(lores_tilde(600, 0.5))[0]   # cutoff Hz, resonance
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (knob.outs[0], cutoff.ins[0]),
    (cutoff.outs[0], filt.ins[1]),
    (buzz.outs[0], filt.ins[0]),
    (filt.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("ctlin")
