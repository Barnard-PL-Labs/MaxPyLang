"""One outlet per channel
mc.route sends each value out the outlet for its channel, using the channel number from mc.snapshot~'s right outlet. Channel 1 of two slow sines steps the pitch of cycle~; channel 2 is shown in a number box.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, flonum, loadbang, mc_cycle_tilde, mc_route, mc_snapshot_tilde, scale

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
rates = patch.place("message chans 2, applyvalues 0.2 0.3")[0]   # two slow sines
lfo = patch.place(mc_cycle_tilde(0.2))[0]
grab = patch.place(mc_snapshot_tilde(125))[0]   # every 125 ms, channel by channel
split = patch.place(mc_route(2))[0]         # 2 outlets: channel 1, channel 2
second = patch.place(flonum)[0]
hz = patch.place(scale(-1, 1, 220, 440))[0]   # -1..1 to 220..440 Hz
osc = patch.place(cycle_tilde(262))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], rates.ins[0]),
    (rates.outs[0], lfo.ins[0]),
    (lfo.outs[0], grab.ins[0]),
    (grab.outs[1], split.ins[1]),           # channel number first...
    (grab.outs[0], split.ins[0]),           # ...then the value
    (split.outs[0], hz.ins[0]),
    (split.outs[1], second.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("mc_route")
