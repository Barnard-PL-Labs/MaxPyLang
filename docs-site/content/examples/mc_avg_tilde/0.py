"""The average level of each channel
mc.avg~ reports the average loudness of every channel since the last bang. metro bangs it every 100 ms; the number box shows the levels of two plucked tones as they fade.
"""
import maxpylang as mp
from maxpylang.objects import flonum, loadbang, mc_avg_tilde, mc_cycle_tilde, mc_ezdac_tilde, mc_phasor_tilde, metro

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
rates = patch.place("message chans 2, applyvalues -1 -1.5")[0]   # negative: ramps fall 1 to 0
pitches = patch.place("message chans 2, applyvalues 392 523")[0]
env = patch.place(mc_phasor_tilde(-1))[0]
osc = patch.place(mc_cycle_tilde(392))[0]
amp = patch.place("mc.*~ 0.")[0]            # tone times the falling ramp
quiet = patch.place("mc.*~ 0.2")[0]
clock = patch.place(metro(100, active=1))[0]
level = patch.place(mc_avg_tilde)[0]
show = patch.place(flonum)[0]
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
    (quiet.outs[0], level.ins[0]),
    (clock.outs[0], level.ins[0]),          # bang: report and start again
    (level.outs[0], show.ins[0]),
)
patch.save("mc_avg")
