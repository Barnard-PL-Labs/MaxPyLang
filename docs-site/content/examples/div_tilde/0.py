"""Divide a pitch: the undertones
sig~ holds 880 and /~ divides it before it reaches cycle~: by 2 you hear 440 Hz. Press ▶, then drag the dial to divide by 1 to 8 and step down the undertone series.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, dial, ezdac_tilde, scale, sig_tilde

patch = mp.MaxPatch()
knob = patch.place(dial)[0]
divisor = patch.place(scale(0, 127, 1, 8))[0]   # whole numbers 1..8
hz = patch.place(sig_tilde(880))[0]
div = patch.place("/~ 2")[0]                    # 880 / 2 = 440 until you move the dial
osc = patch.place(cycle_tilde(0))[0]            # 0: the frequency comes from the signal
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (knob.outs[0], divisor.ins[0]),
    (divisor.outs[0], div.ins[1]),
    (hz.outs[0], div.ins[0]),
    (div.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("div_tilde")
