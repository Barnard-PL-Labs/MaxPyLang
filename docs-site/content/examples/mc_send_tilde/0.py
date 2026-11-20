"""Sending two channels without a cord
mc.send~ duet 2 sends a 2-channel signal to every mc.receive~ named "duet" that asks for 2 channels. The second argument is the channel count; without it only channel 1 is sent.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_receive_tilde, mc_send_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 294 370")[0]   # 2 channels
osc = patch.place(mc_cycle_tilde(294))[0]
tx = patch.place(mc_send_tilde("duet", 2))[0]   # name, channels
rx = patch.place(mc_receive_tilde("duet", 2))[0]
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], osc.ins[0]),
    (osc.outs[0], tx.ins[0]),
    (rx.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_send")
