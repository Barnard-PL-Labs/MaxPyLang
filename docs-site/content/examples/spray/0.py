"""Send each note to a voice
spray sends a value out of the outlet numbered in front of it: "0 64" goes out of the left outlet, "1 69" out of the right. Notes go to the two voices in turn, so each holds its note while the other moves.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, pack, random, spray, trigger

patch = mp.MaxPatch()
clock = patch.place(metro(300, active=1))[0]
order = patch.place(trigger("b", "b"))[0]
pick = patch.place(random(13))[0]
note = patch.place("+ 60")[0]
voice = patch.place(counter(0, 1))[0]    # 0 1 0 1 ...
pair = patch.place(pack(0, 0))[0]        # "voice note"
route = patch.place(spray(2))[0]
hz_a, hz_b = patch.place(mtof, num_objs=2)
osc_a, osc_b = patch.place(cycle_tilde, num_objs=2)
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], order.ins[0]),
    (order.outs[1], pick.ins[0]),      # the note first, into pack's cold inlet
    (pick.outs[0], note.ins[0]),
    (note.outs[0], pair.ins[1]),
    (order.outs[0], voice.ins[0]),     # then the voice, which sends the pair
    (voice.outs[0], pair.ins[0]),
    (pair.outs[0], route.ins[0]),
    (route.outs[0], hz_a.ins[0]),
    (route.outs[1], hz_b.ins[0]),
    (hz_a.outs[0], osc_a.ins[0]),
    (hz_b.outs[0], osc_b.ins[0]),
    (osc_a.outs[0], quiet.ins[0]),
    (osc_b.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("spray")
