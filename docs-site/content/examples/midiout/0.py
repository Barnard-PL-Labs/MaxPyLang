"""MIDI thru
midiin receives raw MIDI bytes from a device and midiout sends raw bytes to one: connected, every message from your keyboard goes straight on to a synth. In Max, double-click each to pick the device.
"""
import maxpylang as mp
from maxpylang.objects import midiin, midiout

patch = mp.MaxPatch()
keys = patch.place(midiin)[0]
synth = patch.place(midiout)[0]

patch.connect((keys.outs[0], synth.ins[0]))
patch.save("midi_thru")
