"""Grabbing a stutter from a loop
record~ records a signal into a buffer~: 1 starts it, and it stops by itself when the buffer~ is full. Here the drum loop plays (silently) into record~, and every 2.4 seconds metro starts a new take, so the 400 ms buffer~ "snip" fills with whatever the drums are playing. groove~ loops snip, and you hear one beat of the loop stuttering, a new one with each take. drumLoop.aif comes with Max; on this page a CC0 drum loop stands in for it.
"""
import maxpylang as mp
from maxpylang.objects import buffer_tilde, ezdac_tilde, groove_tilde, metro, record_tilde, sig_tilde

patch = mp.MaxPatch()
drums = patch.place(buffer_tilde("drums", "drumLoop.aif"))[0]
snip = patch.place(buffer_tilde("snip", 400))[0]          # 400 ms of memory to record into
speed = patch.place(sig_tilde(1))[0]
source = patch.place(groove_tilde("drums", loop=1))[0]     # the drum loop, not sent to the speakers
clock = patch.place(metro(2400, active=1))[0]
start = patch.place("message 1")[0]                        # 1 starts recording
rec = patch.place(record_tilde("snip"))[0]
player = patch.place(groove_tilde("snip", loop=1))[0]      # loops the 400 ms take
quiet = patch.place("*~ 0.3")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (speed.outs[0], source.ins[0]),
    (source.outs[0], rec.ins[0]),
    (clock.outs[0], start.ins[0]),
    (start.outs[0], rec.ins[0]),
    (speed.outs[0], player.ins[0]),
    (player.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("record_stutter")
