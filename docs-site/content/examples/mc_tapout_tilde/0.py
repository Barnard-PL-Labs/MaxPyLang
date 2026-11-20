"""Set the echo time
mc.tapout~ reads every channel of mc.tapin~'s delay lines a set time back: 250 ms to start. Type a time from 1 to 1000 in the number box to move the echo of both click tracks.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_ezdac_tilde, mc_tapin_tilde, mc_tapout_tilde, mc_train_tilde, number

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 1000 1500")[0]   # click period in ms
clicks = patch.place(mc_train_tilde(1000, 0.01))[0]
rec = patch.place(mc_tapin_tilde(1000))[0]   # holds up to 1000 ms per channel
time = patch.place(number)[0]               # echo time in ms
tap = patch.place(mc_tapout_tilde(250))[0]
mix = patch.place("mc.+~")[0]               # dry plus echo
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], clicks.ins[0]),
    (clicks.outs[0], rec.ins[0]),
    (rec.outs[0], tap.ins[0]),              # tapin~ always connects to tapout~
    (time.outs[0], tap.ins[0]),
    (clicks.outs[0], mix.ins[0]),
    (tap.outs[0], mix.ins[1]),
    (mix.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_tapout")
