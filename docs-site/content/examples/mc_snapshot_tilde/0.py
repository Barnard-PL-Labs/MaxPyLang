"""Every channel, one after another
mc.snapshot~ samples each channel every 125 ms: the channel number comes out the right outlet, then its value out the left. Both values reach scale, and the second wins, so the melody follows channel 2. Use mc.route to split them.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, loadbang, mc_cycle_tilde, mc_snapshot_tilde, mtof, number, scale

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
rates = patch.place("message chans 2, applyvalues 0.2 0.3")[0]   # two slow sines
lfo = patch.place(mc_cycle_tilde(0.2))[0]
grab = patch.place(mc_snapshot_tilde(125))[0]   # report every 125 ms
which = patch.place(number)[0]              # shows the channel number
note = patch.place(scale(-1, 1, 60, 72))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], rates.ins[0]),
    (rates.outs[0], lfo.ins[0]),
    (lfo.outs[0], grab.ins[0]),
    (grab.outs[1], which.ins[0]),
    (grab.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("mc_snapshot")
