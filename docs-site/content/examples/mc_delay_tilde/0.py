"""Echoes on two click tracks
mc.delay~ delays every channel by a number of samples: 11025, a quarter second at 44.1 kHz. Adding the delayed clicks to the dry ones doubles each click track.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_delay_tilde, mc_ezdac_tilde, mc_train_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 1000 750")[0]   # click period in ms
clicks = patch.place(mc_train_tilde(1000, 0.01))[0]
echo = patch.place(mc_delay_tilde(44100, 11025))[0]   # max samples, delay samples
mix = patch.place("mc.+~")[0]               # dry plus echo, channel by channel
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], clicks.ins[0]),
    (clicks.outs[0], echo.ins[0]),
    (clicks.outs[0], mix.ins[0]),
    (echo.outs[0], mix.ins[1]),
    (mix.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_delay")
