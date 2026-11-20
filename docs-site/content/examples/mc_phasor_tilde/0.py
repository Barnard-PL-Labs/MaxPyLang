"""Two against three
mc.phasor~ makes a 0..1 ramp per channel, at 2 and 3 Hz. Multiplying two tones by them gives swelling pulses, two a second on the left against three on the right.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_phasor_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
rates = patch.place("message chans 2, applyvalues 2 3")[0]       # ramps per second
pitches = patch.place("message chans 2, applyvalues 440 660")[0]
ramp = patch.place(mc_phasor_tilde(2))[0]
osc = patch.place(mc_cycle_tilde(440))[0]
amp = patch.place("mc.*~ 0.")[0]            # channel by channel: tone times ramp
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], rates.ins[0]),
    (start.outs[0], pitches.ins[0]),
    (rates.outs[0], ramp.ins[0]),
    (pitches.outs[0], osc.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (ramp.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_phasor")
