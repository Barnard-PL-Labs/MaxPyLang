"""A round from one list
zl.rot shifts every item in a list along, wrapping the end round to the start. The second voice plays the tune rotated 2 places, so it follows the first 2 notes behind. Press ▶, then change the number box to set how far behind.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, number, trigger, zl_nth, zl_rot

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(1, 8))[0]
order = patch.place(trigger("b", "i"))[0]
tune = patch.place("message 60 62 64 65 67 65 64 62")[0]
shift = patch.place(zl_rot(2))[0]
places = patch.place(number)[0]          # a new rotation distance
lead = patch.place(zl_nth(1))[0]
follow = patch.place(zl_nth(1))[0]
hz_lead, hz_follow = patch.place(mtof, num_objs=2)
osc_lead, osc_follow = patch.place(cycle_tilde, num_objs=2)
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], order.ins[0]),
    (order.outs[1], lead.ins[1]),
    (order.outs[1], follow.ins[1]),
    (order.outs[0], tune.ins[0]),
    (tune.outs[0], lead.ins[0]),
    (tune.outs[0], shift.ins[0]),
    (places.outs[0], shift.ins[1]),
    (shift.outs[0], follow.ins[0]),
    (lead.outs[0], hz_lead.ins[0]),
    (follow.outs[0], hz_follow.ins[0]),
    (hz_lead.outs[0], osc_lead.ins[0]),
    (hz_follow.outs[0], osc_follow.ins[0]),
    (osc_lead.outs[0], quiet.ins[0]),
    (osc_follow.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("zl.rot")
