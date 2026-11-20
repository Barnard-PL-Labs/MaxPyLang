"""A grid of notes
matrixctrl is a grid of switches; clicking a cell sends the list "column row value". Like a guitar neck, each column is a semitone up and each row a fourth up, counted from C3. Press ▶, then click cells in the matrixctrl to play their notes.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, mtof, unpack

patch = mp.MaxPatch()
grid = patch.place(mp.MaxObject("matrixctrl", columns=8, rows=8))[0]
cell = patch.place(unpack(0, 0))[0]        # keeps column and row, drops the value
fourths = patch.place("* 5")[0]
add = patch.place("+ 0")[0]                # column + 5 * row
note = patch.place("+ 48")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde(131))[0]     # note 48 until you click
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (grid.outs[0], cell.ins[0]),
    (cell.outs[1], fourths.ins[0]),      # unpack sends right to left: the row first
    (fourths.outs[0], add.ins[1]),
    (cell.outs[0], add.ins[0]),
    (add.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("matrixctrl")
