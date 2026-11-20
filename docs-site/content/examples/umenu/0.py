"""Choosing notes from a menu
umenu is a pop-up menu: choosing an item sends its number (from 0) out the left outlet and its text, as a message, out the middle one. At load the menu is cleared and given the items 60, 64, 67 and 72, and the counter chooses each in turn, so the menu's notes play as a C major arpeggio.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, loadbang, metro, mtof, trigger, umenu

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
steps = patch.place(trigger("b", "b", "b", "b", "b"))[0]   # fires right to left
empty = patch.place("message clear")[0]
c = patch.place("message append 60")[0]
e = patch.place("message append 64")[0]
g = patch.place("message append 67")[0]
c2 = patch.place("message append 72")[0]
menu = patch.place(umenu)[0]
clock = patch.place(metro(300, active=1))[0]
choose = patch.place(counter(0, 3))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], steps.ins[0]),
    (steps.outs[4], empty.ins[0]),
    (steps.outs[3], c.ins[0]),
    (steps.outs[2], e.ins[0]),
    (steps.outs[1], g.ins[0]),
    (steps.outs[0], c2.ins[0]),
    (empty.outs[0], menu.ins[0]),
    (c.outs[0], menu.ins[0]),
    (e.outs[0], menu.ins[0]),
    (g.outs[0], menu.ins[0]),
    (c2.outs[0], menu.ins[0]),
    (clock.outs[0], choose.ins[0]),
    (choose.outs[0], menu.ins[0]),
    (menu.outs[1], hz.ins[0]),       # the item's text: a MIDI note
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("umenu")
