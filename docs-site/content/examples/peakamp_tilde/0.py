"""Louder is brighter
peakamp~ 50 reports the loudest sample it heard every 50 ms. A sawtooth swells and fades, and its peak, times 3000, sets lores~'s cutoff: the filter opens as the sound gets louder.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, lores_tilde, peakamp_tilde, saw_tilde

patch = mp.MaxPatch()
lfo = patch.place(cycle_tilde(0.5))[0]
span = patch.place("*~ 0.5")[0]
level = patch.place("+~ 0.5")[0]           # 0..1
saw = patch.place(saw_tilde(110))[0]
amp = patch.place("*~ 0.")[0]              # times the level
peak = patch.place(peakamp_tilde(50))[0]   # report every 50 ms
hz = patch.place("* 3000.")[0]
cutoff = patch.place("+ 200.")[0]          # 200..3200 Hz
filt = patch.place(lores_tilde(500, 0.6))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (lfo.outs[0], span.ins[0]), (span.outs[0], level.ins[0]),
    (saw.outs[0], amp.ins[0]), (level.outs[0], amp.ins[1]),
    (amp.outs[0], peak.ins[0]), (peak.outs[0], hz.ins[0]),
    (hz.outs[0], cutoff.ins[0]), (cutoff.outs[0], filt.ins[1]),
    (amp.outs[0], filt.ins[0]),
    (filt.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("peakamp_tilde")
