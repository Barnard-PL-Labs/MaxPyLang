"""Numbers from text
fromsymbol reads a symbol as a message: the text "60 64 67 72" becomes four numbers again. Here tosymbol makes the text, and after fromsymbol zl.nth can pick the notes out one by one.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, fromsymbol, metro, mtof, tosymbol, trigger, zl_nth

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(1, 4))[0]
order = patch.place(trigger("b", "i"))[0]
numbers = patch.place("message 60 64 67 72")[0]
text = patch.place(tosymbol)[0]          # one item: the text "60 64 67 72"
back = patch.place(fromsymbol)[0]        # four items: 60 64 67 72
pick = patch.place(zl_nth(1))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], order.ins[0]),
    (order.outs[1], pick.ins[1]),
    (order.outs[0], numbers.ins[0]),
    (numbers.outs[0], text.ins[0]),
    (text.outs[0], back.ins[0]),
    (back.outs[0], pick.ins[0]),
    (pick.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("fromsymbol")
