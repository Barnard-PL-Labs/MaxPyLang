"""Notes to a MIDI synth
makenote gives each pitch a velocity of 100 and sends its note-off 300 ms later; noteout sends both to a MIDI device or software synth. In Max, double-click noteout to pick the device.
"""
import maxpylang as mp
from maxpylang.objects import counter, makenote, metro, noteout

patch = mp.MaxPatch()
clock = patch.place(metro(400, active=1))[0]
step = patch.place(counter(60, 67))[0]        # C to G, over and over
note = patch.place(makenote(100, 300))[0]     # velocity, duration (ms)
midi = patch.place(noteout)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], note.ins[0]),
    (note.outs[0], midi.ins[0]),      # pitch
    (note.outs[1], midi.ins[1]),      # velocity (0 is note-off)
)
patch.save("notes_out")
