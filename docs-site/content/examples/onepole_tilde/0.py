"""A gentle low-pass
onepole~ is the simplest filter: it softens everything above its frequency (500 Hz), without resonance.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, onepole_tilde, saw_tilde

patch = mp.MaxPatch()
saw = patch.place(saw_tilde(110))[0]
soft = patch.place(onepole_tilde(500))[0]
quiet = patch.place("*~ 0.2")[0]        # turn it down
out = patch.place(ezdac_tilde)[0]       # to both speakers

patch.connect(
    (saw.outs[0], soft.ins[0]),
    (soft.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("onepole_tilde")
