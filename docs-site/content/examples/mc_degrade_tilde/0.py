"""Lo-fi on every channel
mc.degrade~ lowers the sample rate and bit depth of each channel: 0.2 of the rate and 4 bits. Type a bit depth from 1 to 24 in the number box to change both channels at once.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_degrade_tilde, mc_ezdac_tilde, number

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 330 440")[0]   # 2 channels
osc = patch.place(mc_cycle_tilde(330))[0]
bits = patch.place(number)[0]               # 1 is harsh, 24 is clean
crunch = patch.place(mc_degrade_tilde(0.2, 4))[0]   # rate ratio, bits
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], osc.ins[0]),
    (osc.outs[0], crunch.ins[0]),
    (bits.outs[0], crunch.ins[2]),
    (crunch.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_degrade")
