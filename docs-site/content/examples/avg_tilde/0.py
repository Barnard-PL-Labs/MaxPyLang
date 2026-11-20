"""A second voice that follows the level
On each bang avg~ reports the average size of the signal since the last bang. metro asks ten times a second while a tone pulses, and the answer sets a second tone's pitch: it slides up as the first gets louder.
"""
import maxpylang as mp
from maxpylang.objects import avg_tilde, cycle_tilde, ezdac_tilde, metro, scale

patch = mp.MaxPatch()
lfo = patch.place(cycle_tilde(0.5))[0]
span = patch.place("*~ 0.5")[0]
level = patch.place("+~ 0.5")[0]          # 0..1
voice = patch.place(cycle_tilde(220))[0]
amp = patch.place("*~ 0.")[0]             # times the level
clock = patch.place(metro(100, active=1))[0]
measure = patch.place(avg_tilde)[0]
hz = patch.place(scale(0., 1., 330., 1130.))[0]   # level 0..1 to 330..1130 Hz
follow = patch.place(cycle_tilde(330))[0]
mix = patch.place("+~")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (lfo.outs[0], span.ins[0]), (span.outs[0], level.ins[0]),
    (voice.outs[0], amp.ins[0]), (level.outs[0], amp.ins[1]),
    (amp.outs[0], measure.ins[0]), (clock.outs[0], measure.ins[0]),
    (measure.outs[0], hz.ins[0]), (hz.outs[0], follow.ins[0]),
    (amp.outs[0], mix.ins[0]), (follow.outs[0], mix.ins[1]),
    (mix.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("avg_tilde")
