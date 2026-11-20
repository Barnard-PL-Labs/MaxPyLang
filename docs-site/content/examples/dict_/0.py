"""Storing and reading a value by name
dict holds values under names (keys). The message box first sets pitch to 440, then asks for it; dict sends "pitch 440" out its second outlet, route pitch keeps the 440, and a sine plays it.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, dict_, ezdac_tilde, loadbang, route

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
ask = patch.place("message set pitch 440, get pitch")[0]
store = patch.place(dict_("settings"))[0]
pick = patch.place(route("pitch"))[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], ask.ins[0]),
    (ask.outs[0], store.ins[0]),
    (store.outs[1], pick.ins[0]),      # the value asked for, after its key
    (pick.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("dict_value")
