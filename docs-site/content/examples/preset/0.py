"""Saving settings
preset remembers the settings of the patch's sliders and number boxes. In Max, shift-click a slot to store the slider's current position and click the slot to bring it back. Its outlets connect only to choose which objects it remembers; unconnected, it remembers all of them.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, loadmess, mtof, preset, slider

patch = mp.MaxPatch()
memory = patch.place(preset)[0]
start = patch.place(loadmess(60))[0]
pitch = patch.place(slider)[0]                # 0 to 127, a MIDI note
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], pitch.ins[0]),
    (pitch.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("presets")
