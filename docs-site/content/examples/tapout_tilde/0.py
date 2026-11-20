"""An echo on the right
tapin~ keeps the last second of the notes and tapout~ reads it 375 ms later: you hear each note on the left, then its echo on the right. Press ▶, then drag the dial to set the echo from 0 to 1000 ms.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, dial, ezdac_tilde, line_tilde, metro, scale, tapin_tilde, tapout_tilde

patch = mp.MaxPatch()
clock = patch.place(metro(750, active=1))[0]
shape = patch.place("message 1 5 0 150")[0]
env = patch.place(line_tilde)[0]
osc = patch.place(cycle_tilde(660))[0]
amp = patch.place("*~ 0.")[0]                  # times the envelope
rec = patch.place(tapin_tilde(1000))[0]        # holds up to 1000 ms
knob = patch.place(dial)[0]
ms = patch.place(scale(0, 127, 0, 1000))[0]
tap = patch.place(tapout_tilde(375))[0]        # 375 ms back until you move the dial
quiet_l = patch.place("*~ 0.2")[0]
quiet_r = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], shape.ins[0]), (shape.outs[0], env.ins[0]),
    (osc.outs[0], amp.ins[0]), (env.outs[0], amp.ins[1]),
    (amp.outs[0], rec.ins[0]),
    (rec.outs[0], tap.ins[0]),                 # tapin~ always connects to tapout~
    (knob.outs[0], ms.ins[0]), (ms.outs[0], tap.ins[0]),
    (amp.outs[0], quiet_l.ins[0]), (tap.outs[0], quiet_r.ins[0]),
    (quiet_l.outs[0], out.ins[0]), (quiet_r.outs[0], out.ins[1]),
)
patch.save("tapout_tilde")
