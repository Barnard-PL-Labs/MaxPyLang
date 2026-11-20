"""Fading echoes on two channels
mc.tapin~ records every channel into its own delay line and mc.tapout~ reads them 300 ms later. Feeding half the echo back makes each click track repeat, quieter each time.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_ezdac_tilde, mc_tapin_tilde, mc_tapout_tilde, mc_train_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 2000 1500")[0]   # click period in ms
clicks = patch.place(mc_train_tilde(2000, 0.01))[0]
mix = patch.place("mc.+~")[0]
rec = patch.place(mc_tapin_tilde(1000))[0]   # holds up to 1000 ms per channel
tap = patch.place(mc_tapout_tilde(300))[0]   # reads 300 ms back
fade = patch.place("mc.*~ 0.5")[0]
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], clicks.ins[0]),
    (clicks.outs[0], mix.ins[0]),
    (mix.outs[0], rec.ins[0]),
    (rec.outs[0], tap.ins[0]),              # tapin~ always connects to tapout~
    (tap.outs[0], fade.ins[0]),
    (fade.outs[0], mix.ins[1]),             # feedback: the echo goes round again
    (mix.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_tapin")
