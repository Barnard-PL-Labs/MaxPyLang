"""A two-sound drum loop
loadbang appends two sound files to playlist~, and a number plays that clip: counter alternates 1 and 2 every 250 ms, so the kick-and-hat and the snare take turns.
"""
import maxpylang as mp
from maxpylang.objects import counter, ezdac_tilde, loadbang, metro, playlist_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
files = patch.place("message append bd+hh.aiff, append snare.aiff")[0]   # files that come with Max
clock = patch.place(metro(250, active=1))[0]
clip = patch.place(counter(1, 2))[0]        # clips count from 1
player = patch.place(playlist_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], files.ins[0]),
    (files.outs[0], player.ins[0]),
    (clock.outs[0], clip.ins[0]),
    (clip.outs[0], player.ins[0]),
    (player.outs[0], quiet.ins[0]),         # left channel
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("playlist_tilde")
