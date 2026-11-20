"""Write raw MIDI
midiformat turns numbers into MIDI bytes; its third inlet makes control changes from "controller value". A counter sweeps controller 74 from 0 to 127, and midiparse reads it back to open the filter on a saw~.
"""
import maxpylang as mp
from maxpylang.objects import counter, ezdac_tilde, lores_tilde, metro, midiformat, midiparse, prepend, saw_tilde, scale, unpack

patch = mp.MaxPatch()
clock = patch.place(metro(20, active=1))[0]
sweep = patch.place(counter(0, 127))[0]
cc = patch.place(prepend(74))[0]       # "74 value"
raw = patch.place(midiformat)[0]
parse = patch.place(midiparse)[0]
split = patch.place(unpack(0, 0))[0]
cutoff = patch.place(scale(0, 127, 200, 3000))[0]
buzz = patch.place(saw_tilde(110))[0]
filt = patch.place(lores_tilde(600, 0.5))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], sweep.ins[0]), (sweep.outs[0], cc.ins[0]),
    (cc.outs[0], raw.ins[2]),          # third inlet: control change
    (raw.outs[0], parse.ins[0]),
    (parse.outs[2], split.ins[0]),     # control: number value
    (split.outs[1], cutoff.ins[0]), (cutoff.outs[0], filt.ins[1]),
    (buzz.outs[0], filt.ins[0]),
    (filt.outs[0], quiet.ins[0]), (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]),
)
patch.save("midiformat")
