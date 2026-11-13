import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde

patch = mp.MaxPatch()
osc = patch.place(cycle_tilde(440))[0]
dac = patch.place(ezdac_tilde)[0]
patch.connect((osc.outs[0], dac.ins[0]))
patch.save("hello_world.maxpat")
