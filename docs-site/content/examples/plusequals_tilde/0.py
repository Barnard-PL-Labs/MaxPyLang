"""A pitch that keeps rising
+=~ adds up every sample it receives. Fed a steady 0.002, its sum grows by 88 every second (at 44.1 kHz), and that sum, plus 200, is cycle~'s frequency.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, sig_tilde

patch = mp.MaxPatch()
step = patch.place(sig_tilde(0.002))[0]   # added once per sample
total = patch.place("+=~")[0]  # the running sum: 0, 0.002, 0.004 ...
hz = patch.place("+~ 200")[0]             # start at 200 Hz
osc = patch.place(cycle_tilde(0))[0]      # 0: the frequency comes from the signal
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (step.outs[0], total.ins[0]),
    (total.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("plusequals_tilde")
