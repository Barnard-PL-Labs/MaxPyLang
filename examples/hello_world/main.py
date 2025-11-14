import maxpylang as mp

patch = mp.MaxPatch()
osc = patch.place("cycle~ 440")[0]
dac = patch.place("ezdac~")[0]
patch.connect([osc.outs[0], dac.ins[0]])
patch.save("hello_world.maxpat")