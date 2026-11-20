"""A melody stepped by two signals
mc.edge~ bangs when any channel goes from zero to non-zero. Two sines (2 and 3 Hz), cut to their positive halves by mc.clip~, start up five times a second between them, and each bang steps counter up a scale.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, loadbang, mc_clip_tilde, mc_cycle_tilde, mc_edge_tilde, mtof

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
rates = patch.place("message chans 2, applyvalues 2 3")[0]       # 2 channels
lfo = patch.place(mc_cycle_tilde(2))[0]
half = patch.place(mc_clip_tilde(0, 1))[0]  # 0 for the negative half
edge = patch.place(mc_edge_tilde)[0]
step = patch.place(counter(60, 72))[0]      # MIDI notes 60..72
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], rates.ins[0]),
    (rates.outs[0], lfo.ins[0]),
    (lfo.outs[0], half.ins[0]),
    (half.outs[0], edge.ins[0]),
    (edge.outs[0], step.ins[0]),            # outlet 0: zero to non-zero
    (step.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("mc_edge")
