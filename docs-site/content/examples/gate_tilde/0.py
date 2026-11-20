"""Chop a drone
gate~ 1 1 passes the signal in its right inlet while its left inlet is 1 and outputs silence at 0. metro and counter alternate 1 and 0 every 250 ms, chopping a filtered sawtooth into pulses.
"""
import maxpylang as mp
from maxpylang.objects import counter, ezdac_tilde, gate_tilde, lores_tilde, metro, saw_tilde

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
onoff = patch.place(counter(0, 1))[0]      # 0, 1, 0, 1 ...
saw = patch.place(saw_tilde(110))[0]
soft = patch.place(lores_tilde(800, 0.3))[0]
gate = patch.place(gate_tilde(1, 1))[0]     # 1 outlet, open to start
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], onoff.ins[0]),
    (onoff.outs[0], gate.ins[0]),
    (saw.outs[0], soft.ins[0]),
    (soft.outs[0], gate.ins[1]),
    (gate.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("gate_tilde")
