"""Measuring every channel
mc.peakamp~ reports the loudest sample of each channel every 250 ms, one channel after another (the channel number comes out the right outlet). You hear two plucked tones; the number box shows their peaks falling.
"""
import maxpylang as mp
from maxpylang.objects import flonum, loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_peakamp_tilde, mc_phasor_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
rates = patch.place("message chans 2, applyvalues -0.5 -0.75")[0]   # negative: ramps fall 1 to 0
pitches = patch.place("message chans 2, applyvalues 440 660")[0]
env = patch.place(mc_phasor_tilde(-0.5))[0]
osc = patch.place(mc_cycle_tilde(440))[0]
amp = patch.place("mc.*~ 0.")[0]            # tone times the falling ramp
quiet = patch.place("mc.*~ 0.2")[0]
meter = patch.place(mc_peakamp_tilde(250))[0]   # report every 250 ms
peak = patch.place(flonum)[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], rates.ins[0]),
    (start.outs[0], pitches.ins[0]),
    (rates.outs[0], env.ins[0]),
    (pitches.outs[0], osc.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], meter.ins[0]),
    (meter.outs[0], peak.ins[0]),
)
patch.save("mc_peakamp")
