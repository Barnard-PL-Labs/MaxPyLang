"""Switching a chord on and off
mc.gate~ passes every channel of its right inlet when its left inlet gets 1, and silences them all on 0. counter alternates 1 and 0, so the chord stutters four times a second.
"""
import maxpylang as mp
from maxpylang.objects import counter, loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_gate_tilde, metro

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 262 392")[0]   # 2 channels
osc = patch.place(mc_cycle_tilde(262))[0]
clock = patch.place(metro(125, active=1))[0]
onoff = patch.place(counter(0, 1))[0]       # 0, 1, 0, 1, ...
gate = patch.place(mc_gate_tilde)[0]        # closed until it gets 1
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], osc.ins[0]),
    (clock.outs[0], onoff.ins[0]),
    (onoff.outs[0], gate.ins[0]),
    (osc.outs[0], gate.ins[1]),
    (gate.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_gate")
