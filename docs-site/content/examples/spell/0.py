"""Spell a word out in notes
spell sends the character code of each letter of a word: "hello" gives 104 101 108 108 111. At the start of each word they go into zl.queue, and one letter plays per beat.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, select, spell, trigger, zl_queue

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
beat = patch.place(counter(0, 4))[0]     # five letters
order = patch.place(trigger("b", "i"))[0]
start = patch.place(select(0))[0]
word = patch.place("message hello")[0]
letters = patch.place(spell)[0]
fifo = patch.place(zl_queue)[0]
note = patch.place("- 36")[0]            # h = 104 -> 68
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], beat.ins[0]),
    (beat.outs[0], order.ins[0]),
    (order.outs[1], start.ins[0]),     # beat 0: spell the word into the queue
    (start.outs[0], word.ins[0]),
    (word.outs[0], letters.ins[0]),
    (letters.outs[0], fifo.ins[0]),
    (order.outs[0], fifo.ins[0]),      # every beat: play the next letter
    (fifo.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("spell")
