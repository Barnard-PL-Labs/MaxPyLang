"""Playing the clock
date answers the message time with the current hour, minute and second out its middle outlet. Once a second, metro asks for the time; unpack takes the seconds, and the sine plays that many semitones above a low C, so the pitch climbs a semitone every second and drops back at the top of each minute.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, date, ezdac_tilde, metro, mtof, unpack

patch = mp.MaxPatch()
clock = patch.place(metro(1000, active=1))[0]
ask = patch.place("message time")[0]
now = patch.place(date)[0]                    # outlets: date, time, ticks
hms = patch.place(unpack(0, 0, 0))[0]         # hour, minute, second
pitch = patch.place("+ 36")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], ask.ins[0]),
    (ask.outs[0], now.ins[0]),
    (now.outs[1], hms.ins[0]),
    (hms.outs[2], pitch.ins[0]),
    (pitch.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("date")
