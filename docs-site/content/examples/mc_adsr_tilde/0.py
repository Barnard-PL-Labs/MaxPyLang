"""Two notes, one envelope box
mc.adsr~ with 2 channels makes an attack-decay-sustain-release envelope for each voice of mc.saw~. counter alternates 1 and 0, so both notes hold for 600 ms, then fade.
"""
import maxpylang as mp
from maxpylang.objects import counter, loadbang, mc_adsr_tilde, mc_ezdac_tilde, mc_saw_tilde, metro

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 110 165")[0]   # 2 channels
two = patch.place("message chans 2")[0]     # one envelope per channel
clock = patch.place(metro(600, active=1))[0]
gate = patch.place(counter(0, 1))[0]        # 0, 1, 0, 1, ...
env = patch.place(mc_adsr_tilde(10, 150, 0.5, 300))[0]   # attack, decay ms, sustain level, release ms
saw = patch.place(mc_saw_tilde(110))[0]
amp = patch.place("mc.*~ 0.")[0]            # channel by channel: saw times envelope
quiet = patch.place("mc.*~ 0.15")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (start.outs[0], two.ins[0]),
    (voices.outs[0], saw.ins[0]),
    (two.outs[0], env.ins[0]),
    (clock.outs[0], gate.ins[0]),
    (gate.outs[0], env.ins[0]),             # the gate reaches every channel
    (saw.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_adsr")
