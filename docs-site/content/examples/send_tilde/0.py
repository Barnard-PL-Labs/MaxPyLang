"""Audio without a cord
send~ and receive~ with the same name ("tone") connect without a patch cord: useful in a large patch, or between subpatches.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, receive_tilde, send_tilde

patch = mp.MaxPatch()
osc = patch.place(cycle_tilde(294))[0]
tx = patch.place(send_tilde("tone"))[0]
rx = patch.place(receive_tilde("tone"))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (osc.outs[0], tx.ins[0]),
    (rx.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("send")
