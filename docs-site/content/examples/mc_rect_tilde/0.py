"""Two square waves a fifth apart
mc.rect~ makes one square wave per channel: 98 Hz and 147 Hz. mc.lores~ then softens both channels with a single filter box.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_ezdac_tilde, mc_lores_tilde, mc_rect_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 98 147")[0]   # 2 channels
sq = patch.place(mc_rect_tilde(98))[0]
soft = patch.place(mc_lores_tilde(900, 0.3))[0]   # one filter per channel, made for you
quiet = patch.place("mc.*~ 0.15")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], sq.ins[0]),
    (sq.outs[0], soft.ins[0]),
    (soft.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_rect")
