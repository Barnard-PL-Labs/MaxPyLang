"""Plucks from ramps
mc.rminus~ subtracts each channel from its argument. 1 minus a rising 0..1 ramp is a falling one, so two tones pluck, twice a second on the left and three times on the right.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_phasor_tilde, mc_rminus_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
rates = patch.place("message chans 2, applyvalues 2 3")[0]       # plucks per second
pitches = patch.place("message chans 2, applyvalues 523 659")[0]
ramp = patch.place(mc_phasor_tilde(2))[0]
fall = patch.place(mc_rminus_tilde(1))[0]   # 1 - ramp: from 1 down to 0
osc = patch.place(mc_cycle_tilde(523))[0]
amp = patch.place("mc.*~ 0.")[0]            # tone times the falling ramp
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], rates.ins[0]),
    (start.outs[0], pitches.ins[0]),
    (rates.outs[0], ramp.ins[0]),
    (pitches.outs[0], osc.ins[0]),
    (ramp.outs[0], fall.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (fall.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_rminus")
