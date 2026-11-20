"""Rhythms from slow waves
mc.thresh~ outputs 1 once a channel rises above 0.5, and 0 again once it falls below 0. Two slow sines (1 and 1.5 Hz) become on/off gates, so two tones pulse three against two.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_thresh_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
rates = patch.place("message chans 2, applyvalues 1 1.5")[0]     # pulses per second
pitches = patch.place("message chans 2, applyvalues 523 784")[0]
lfo = patch.place(mc_cycle_tilde(1))[0]
gate = patch.place(mc_thresh_tilde(0, 0.5))[0]   # reset level, set level
osc = patch.place(mc_cycle_tilde(523))[0]
amp = patch.place("mc.*~ 0.")[0]            # tone times the 0/1 gate
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], rates.ins[0]),
    (start.outs[0], pitches.ins[0]),
    (rates.outs[0], lfo.ins[0]),
    (pitches.outs[0], osc.ins[0]),
    (lfo.outs[0], gate.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (gate.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_thresh")
