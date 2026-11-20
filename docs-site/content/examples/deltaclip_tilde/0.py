"""Soften a square wave
deltaclip~ -0.02 0.02 lets a signal move at most 0.02 per sample, so rect~'s instant jumps from -1 to 1 become 100-sample slopes and the square sounds rounder.
"""
import maxpylang as mp
from maxpylang.objects import deltaclip_tilde, ezdac_tilde, rect_tilde

patch = mp.MaxPatch()
square = patch.place(rect_tilde(110))[0]
slew = patch.place(deltaclip_tilde(-0.02, 0.02))[0]   # fastest fall, fastest rise, per sample
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (square.outs[0], slew.ins[0]),
    (slew.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("deltaclip_tilde")
