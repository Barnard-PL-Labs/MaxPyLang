"""Max for Live MIDI effect: transpose every note up 7 semitones."""
import maxpylang as mp
from maxpylang.objects import midiformat, midiin, midiout, midiparse

patch = mp.MaxPatch(verbose=False)

patch.set_position(30, 30)
src = patch.place(midiin)[0]           # raw MIDI from the track
patch.set_position(30, 90)
parse = patch.place(midiparse)[0]      # outlet 0: notes, as a list (pitch, velocity)
patch.set_position(30, 150)
split = patch.place("unpack 0 0")[0]   # sends velocity (right) first, then pitch (left)
patch.set_position(30, 210)
up = patch.place("+ 7")[0]
patch.set_position(30, 270)
join = patch.place("pack 0 0")[0]      # velocity waits in the right inlet; pitch sends the pair
patch.set_position(30, 330)
fmt = patch.place(midiformat)[0]       # inlet 0: notes, as a list (pitch, velocity)
patch.set_position(30, 390)
out = patch.place(midiout)[0]          # to the next device on the track

patch.connect(
    (src.outs[0], parse.ins[0]),
    (parse.outs[0], split.ins[0]),
    (split.outs[0], up.ins[0]),
    (split.outs[1], join.ins[1]),
    (up.outs[0], join.ins[0]),
    (join.outs[0], fmt.ins[0]),
    (fmt.outs[0], out.ins[0]),
)

patch.save("transpose.amxd", device_type="midi_effect")
