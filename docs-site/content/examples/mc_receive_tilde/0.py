"""Receiving two sources by name
mc.receive~ outputs what every mc.send~ with its name sends, added together. Two senders named "bus", one with a chord and one with soft noise, arrive mixed in one box.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_noise_tilde, mc_receive_tilde, mc_send_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 330 440")[0]   # 2 channels of tone
two = patch.place("message chans 2")[0]     # 2 channels of noise
osc = patch.place(mc_cycle_tilde(330))[0]
hiss = patch.place(mc_noise_tilde)[0]
soft = patch.place("mc.*~ 0.1")[0]
tones = patch.place(mc_send_tilde("bus", 2))[0]   # name, channels
noise = patch.place(mc_send_tilde("bus", 2))[0]   # same name: the two add up
rx = patch.place(mc_receive_tilde("bus", 2))[0]
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (start.outs[0], two.ins[0]),
    (voices.outs[0], osc.ins[0]),
    (two.outs[0], hiss.ins[0]),
    (osc.outs[0], tones.ins[0]),
    (hiss.outs[0], soft.ins[0]),
    (soft.outs[0], noise.ins[0]),
    (rx.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_receive")
