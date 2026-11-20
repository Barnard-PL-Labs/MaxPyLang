"""Playing part of a file with line~
play~ outputs the sample at the position its input signal gives, in milliseconds. Every 1.6 seconds the message sends line~ back to 0 and then on to 1500 over 1500 ms, so play~ plays the first 1.5 seconds of the loop, again and again. drumLoop.aif comes with Max; on this page a CC0 drum loop stands in for it.
"""
import maxpylang as mp
from maxpylang.objects import buffer_tilde, ezdac_tilde, line_tilde, metro, play_tilde

patch = mp.MaxPatch()
drums = patch.place(buffer_tilde("drums", "drumLoop.aif"))[0]
clock = patch.place(metro(1600, active=1))[0]
sweep = patch.place("message 0 0 1500 1500")[0]      # to 0 in 0 ms, then to 1500 in 1500 ms
position = patch.place(line_tilde(0))[0]
player = patch.place(play_tilde("drums"))[0]
quiet = patch.place("*~ 0.3")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], sweep.ins[0]),
    (sweep.outs[0], position.ins[0]),
    (position.outs[0], player.ins[0]),
    (player.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("play_part")
