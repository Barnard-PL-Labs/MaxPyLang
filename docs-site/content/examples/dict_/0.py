"""A dictionary as a memory
At load, dict stores two pitches under the keys low and high. Every half second a get message asks for one of them; dict answers "low 220" or "high 330" from its second outlet, and route hands the number to the oscillator, so the tone swaps between 220 and 330 Hz.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, dict_, ezdac_tilde, loadbang, metro, route, select

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
store_low = patch.place("message set low 220")[0]
store_high = patch.place("message set high 330")[0]
clock = patch.place(metro(500, active=1))[0]
step = patch.place(counter(0, 1))[0]
pick = patch.place(select(0, 1))[0]
ask_low = patch.place("message get low")[0]
ask_high = patch.place("message get high")[0]
notes = patch.place(dict_("notes"))[0]
by_key = patch.place(route("low", "high"))[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], store_low.ins[0]),
    (start.outs[0], store_high.ins[0]),
    (store_low.outs[0], notes.ins[0]),
    (store_high.outs[0], notes.ins[0]),
    (clock.outs[0], step.ins[0]),
    (step.outs[0], pick.ins[0]),
    (pick.outs[0], ask_low.ins[0]),
    (pick.outs[1], ask_high.ins[0]),
    (ask_low.outs[0], notes.ins[0]),
    (ask_high.outs[0], notes.ins[0]),
    (notes.outs[1], by_key.ins[0]),    # get answers "key value" here
    (by_key.outs[0], osc.ins[0]),
    (by_key.outs[1], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("dict")
