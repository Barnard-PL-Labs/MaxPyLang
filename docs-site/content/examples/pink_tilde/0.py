"""Pink noise
pink~ is noise with less energy in the highs than noise~: softer, like rain or a waterfall.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, pink_tilde

patch = mp.MaxPatch()
rain = patch.place(pink_tilde)[0]
quiet = patch.place("*~ 0.2")[0]        # turn it down
out = patch.place(ezdac_tilde)[0]       # to both speakers

patch.connect(
    (rain.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("pink_tilde")
