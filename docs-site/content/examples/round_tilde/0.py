"""A stepped, crunchy sine
round~ 0.25 rounds every sample to the nearest quarter, so a smooth sine becomes a staircase of 9 levels and buzzes. Press ▶, then drag the dial for bigger steps and a coarser sound.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, dial, ezdac_tilde, round_tilde, scale

patch = mp.MaxPatch()
knob = patch.place(dial)[0]
size = patch.place(scale(0, 127, 0.05, 0.5))[0]   # step size 0.05..0.5
osc = patch.place(cycle_tilde(220))[0]
steps = patch.place(round_tilde(0.25))[0]         # 0.25 until you move the dial
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (knob.outs[0], size.ins[0]),
    (size.outs[0], steps.ins[1]),
    (osc.outs[0], steps.ins[0]),
    (steps.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("round_tilde")
