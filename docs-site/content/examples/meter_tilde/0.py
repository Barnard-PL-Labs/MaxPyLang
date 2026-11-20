"""Watch a level move
meter~ reports the peak of the signal coming in, a few times a second. Here a tone swells and fades every two seconds, and * 127 turns the 0..1 peak into a position for the slider, which rises and falls with it.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, meter_tilde, slider

patch = mp.MaxPatch()
lfo = patch.place(cycle_tilde(0.5))[0]
span = patch.place("*~ 0.5")[0]
level = patch.place("+~ 0.5")[0]          # 0..1
osc = patch.place(cycle_tilde(440))[0]
amp = patch.place("*~ 0.")[0]             # times the level
watch = patch.place(meter_tilde)[0]
pos = patch.place("* 127.")[0]
show = patch.place(slider)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (lfo.outs[0], span.ins[0]), (span.outs[0], level.ins[0]),
    (osc.outs[0], amp.ins[0]), (level.outs[0], amp.ins[1]),
    (amp.outs[0], watch.ins[0]),
    (watch.outs[0], pos.ins[0]), (pos.outs[0], show.ins[0]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("meter_tilde")
