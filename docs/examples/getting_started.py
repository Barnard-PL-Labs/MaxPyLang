"""Getting started: a 440 Hz tone, saved as hello_world.maxpat, then loaded back."""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde

patch = mp.MaxPatch()

# set_position() moves the cursor where the next object goes. y grows downward.
patch.set_position(30, 30)
osc = patch.place(cycle_tilde(440))[0]  # place() returns a list; [0] is the object

patch.set_position(30, 90)
dac = patch.place(ezdac_tilde)[0]

# One cord per (outlet, inlet) pair: the oscillator into both speakers.
patch.connect((osc.outs[0], dac.ins[0]), (osc.outs[0], dac.ins[1]))

patch.save("hello_world")  # adds .maxpat

# Load the file again and list what is in it.
loaded = mp.MaxPatch(load_file="hello_world.maxpat")
for obj_id, obj in loaded.objs.items():
    print(obj_id, obj.name)
