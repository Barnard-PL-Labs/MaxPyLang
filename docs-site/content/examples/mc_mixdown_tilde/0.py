"""Four voices into two speakers
mc.mixdown~ mixes many channels down to fewer, panning each across the outputs. Four sines, a major chord, are spread between left and right.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_mixdown_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 4, applyvalues 220 277 330 440")[0]
osc = patch.place(mc_cycle_tilde(220))[0]
mix = patch.place(mc_mixdown_tilde(2))[0]      # 2 output channels
quiet = patch.place("mc.*~ 0.1")[0]
out = patch.place(mc_ezdac_tilde)[0]

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], osc.ins[0]),
    (osc.outs[0], mix.ins[0]),
    (mix.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_mixdown")
