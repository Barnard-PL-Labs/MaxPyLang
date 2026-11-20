"""Drawing an envelope
function holds breakpoints, which you can also draw with the mouse. The message box sets four points: up to full in 50 ms, down to 0.3 by 400 ms, silent at 1000 ms. Each bang from the metro sends them out function's second outlet as a list for line~, which shapes the level of a tone.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, function, line_tilde, loadbang, metro

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
points = patch.place("message clear, 0 0, 50 1, 400 0.3, 1000 0")[0]   # time (ms), level
clock = patch.place(metro(1000, active=1))[0]
shape = patch.place(function)[0]
env = patch.place(line_tilde(0))[0]
osc = patch.place(cycle_tilde(330))[0]
amp = patch.place("*~ 0")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], points.ins[0]),
    (points.outs[0], shape.ins[0]),
    (clock.outs[0], shape.ins[0]),
    (shape.outs[1], env.ins[0]),       # outlet 1: all the points, in line~'s format
    (osc.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("envelope")
