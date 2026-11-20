"""A clock you can hear
date answers the message time with the hour, minute and second, out its middle outlet. Asked every second, the seconds (0 to 59) are added to 36 and played as a note, so the pitch climbs through each minute and drops back on the minute.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, date, ezdac_tilde, metro, mtof, unpack

patch = mp.MaxPatch()
clock = patch.place(metro(1000, active=1))[0]
ask = patch.place("message time")[0]
now = patch.place(date)[0]
parts = patch.place(unpack(0, 0, 0))[0]       # hour, minute, second
lift = patch.place("+ 36")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], ask.ins[0]),
    (ask.outs[0], now.ins[0]),
    (now.outs[1], parts.ins[0]),
    (parts.outs[2], lift.ins[0]),
    (lift.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("clock_pitch")
