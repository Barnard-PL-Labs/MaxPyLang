"""A port into an abstraction
An abstraction is a patch saved to its own file and placed by name in another patch. Each inlet object in it becomes an inlet on its box, left to right. This script places tremolo in a main patch, then builds tremolo.maxpat: sound comes in the left inlet, a speed in Hz in the right.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, inlet, loadmess, outlet

# The main patch. tremolo's file is built below, so declare its ports here.
patch = mp.MaxPatch()
osc = patch.place(cycle_tilde(220))[0]
speed = patch.place(loadmess(4))[0]            # 4 wobbles a second
trem = patch.place(mp.MaxObject("tremolo", abstraction=True, inlets=2, outlets=1))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]
patch.connect(
    (osc.outs[0], trem.ins[0]),
    (speed.outs[0], trem.ins[1]),
    (trem.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("main")

# tremolo.maxpat, saved next to main.maxpat. Its two inlets are the box's two inlets.
trem_patch = mp.MaxPatch()
sound = trem_patch.place(inlet)[0]             # left: the sound
hz = trem_patch.place(inlet)[0]                # right: the speed
lfo = trem_patch.place(cycle_tilde(4))[0]
depth = trem_patch.place("*~ 0.5")[0]
centre = trem_patch.place("+~ 0.5")[0]         # the level swings between 0 and 1
amp = trem_patch.place("*~ 0")[0]
result = trem_patch.place(outlet)[0]
trem_patch.connect(
    (hz.outs[0], lfo.ins[0]),
    (lfo.outs[0], depth.ins[0]),
    (depth.outs[0], centre.ins[0]),
    (sound.outs[0], amp.ins[0]),
    (centre.outs[0], amp.ins[1]),
    (amp.outs[0], result.ins[0]),
)
trem_patch.save("tremolo")
