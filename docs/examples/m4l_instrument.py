"""Max for Live instrument: MIDI note in, sine tone out."""
import maxpylang as mp
from maxpylang.objects import clip_tilde, cycle_tilde, mtof, notein, plugout_tilde

patch = mp.MaxPatch(verbose=False)

patch.set_position(30, 30)
note = patch.place(notein)[0]          # outlets: pitch, velocity, channel
patch.set_position(30, 90)
freq = patch.place(mtof)[0]            # MIDI pitch -> frequency in Hz
patch.set_position(30, 150)
osc = patch.place(cycle_tilde)[0]
patch.set_position(30, 210)
level = patch.place("*~ 0.2")[0]       # quieter
patch.set_position(30, 270)
safe = patch.place(clip_tilde(-1.0, 1.0))[0]  # keep the output between -1 and 1
patch.set_position(30, 330)
out = patch.place(plugout_tilde)[0]    # to Live; inlets 0 and 1 are left and right

patch.connect(
    (note.outs[0], freq.ins[0]),
    (freq.outs[0], osc.ins[0]),
    (osc.outs[0], level.ins[0]),
    (level.outs[0], safe.ins[0]),
    (safe.outs[0], out.ins[0]),
    (safe.outs[0], out.ins[1]),
)

patch.save("sine_instrument.amxd", device_type="instrument")

# .amxd files load like .maxpat files.
device = mp.MaxPatch(load_file="sine_instrument.amxd", verbose=False)
print(device.num_objs, "objects")
