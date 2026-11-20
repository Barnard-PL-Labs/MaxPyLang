"""Tabs that pick an octave
tab is a row of buttons: choosing one sends its number (from 0) out the left outlet and its text out the middle one. loadbang names the tabs low, mid and high, and the clock chooses each in turn, so a tone climbs an octave at a time, then drops back to the lowest.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, loadbang, metro, mtof, tab

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
names = patch.place("message tabs low mid high")[0]
tabs = patch.place(tab)[0]
clock = patch.place(metro(500, active=1))[0]
choose = patch.place(counter(0, 2))[0]
octave = patch.place("* 12")[0]
note = patch.place("+ 57")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], names.ins[0]),
    (names.outs[0], tabs.ins[0]),
    (clock.outs[0], choose.ins[0]),
    (choose.outs[0], tabs.ins[0]),
    (tabs.outs[0], octave.ins[0]),   # the tab's number: 0, 1, 2
    (octave.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("tab")
