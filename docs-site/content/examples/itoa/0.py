"""Type a number, character by character
itoa turns character codes into text: 54 is the digit 6 and 48 to 55 are 0 to 7, so "54 48" becomes the text "60". fromsymbol reads that text as the number 60, and the notes climb from 60 to 67.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, fromsymbol, itoa, metro, mtof, prepend

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
digit = patch.place(counter(48, 55))[0]  # the codes of 0 .. 7
codes = patch.place(prepend(54))[0]      # the code of 6 in front: "54 48"
text = patch.place(itoa)[0]              # -> the text "60"
number = patch.place(fromsymbol)[0]      # -> the number 60
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], digit.ins[0]),
    (digit.outs[0], codes.ins[0]),
    (codes.outs[0], text.ins[0]),
    (text.outs[0], number.ins[0]),
    (number.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("itoa")
