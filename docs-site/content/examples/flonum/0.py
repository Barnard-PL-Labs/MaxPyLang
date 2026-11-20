"""Set the speed of a tremolo
flonum is a number box for decimals. It sets the rate, in hertz, of a slow cycle~ that swells the volume of a tone up and down. Press ▶, then type 0.5 into the flonum for a slow swell or 12 for a fast flutter.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, flonum

patch = mp.MaxPatch()
rate = patch.place(flonum)[0]
lfo = patch.place(cycle_tilde(4))[0]       # 4 swells a second until you change it
depth = patch.place("*~ 0.5")[0]
offset = patch.place("+~ 0.5")[0]          # -1..1 becomes 0..1, a volume
osc = patch.place(cycle_tilde(330))[0]
amp = patch.place("*~ 0.")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (rate.outs[0], lfo.ins[0]),
    (lfo.outs[0], depth.ins[0]),
    (depth.outs[0], offset.ins[0]),
    (offset.outs[0], amp.ins[1]),
    (osc.outs[0], amp.ins[0]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("flonum")
