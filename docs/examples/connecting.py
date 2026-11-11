"""Connecting objects: stubs, tuples, many objects at once, and midpoints."""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, gain_tilde, metro, toggle, counter, flonum

patch = mp.MaxPatch(verbose=False)

# Stubs give autocomplete and type checking. Call one to add arguments and attributes.
patch.set_position(30, 30)
osc = patch.place(cycle_tilde(220))[0]
patch.set_position(30, 90)
gain = patch.place(gain_tilde)[0]
patch.set_position(30, 230)
dac = patch.place(ezdac_tilde)[0]

# Inlets and outlets are 0-based: outs[0] is the leftmost outlet.
patch.connect(
    (osc.outs[0], gain.ins[0]),
    (gain.outs[0], dac.ins[0]),
    (gain.outs[0], dac.ins[1]),
)

# A string works for any object and is never type-checked.
patch.set_position(200, 30)
tick = patch.place("metro 250 @active 1")[0]
patch.set_position(200, 90)
count = patch.place("counter 0 7")[0]
patch.connect((tick.outs[0], count.ins[0]))

# num_objs places several copies; each is its own object.
toggles = patch.place(toggle, num_objs=4, starting_pos=[350, 30], spacing=[40, 0])
metros = patch.place(metro(500), num_objs=4, starting_pos=[350, 90], spacing=[80, 0])
for t, m in zip(toggles, metros):
    patch.connect((t.outs[0], m.ins[0]))

# A third element bends the cord through midpoints, as a flat list [x1, y1, x2, y2, ...].
patch.set_position(200, 160)
shown = patch.place(flonum)[0]
patch.connect((count.outs[0], shown.ins[0], [210.0, 140.0]))

patch.save("connecting")
