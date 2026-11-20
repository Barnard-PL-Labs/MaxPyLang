"""Switch which sender you hear
Two send~ objects broadcast a sine under the name low and a sawtooth under high. receive~ plays one of them, and the message set high (or set low) re-points it; metro switches every half second.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, receive_tilde, saw_tilde, select, send_tilde

patch = mp.MaxPatch()
sine = patch.place(cycle_tilde(220))[0]
to_low = patch.place(send_tilde("low"))[0]
saw = patch.place(saw_tilde(330))[0]
to_high = patch.place(send_tilde("high"))[0]
clock = patch.place(metro(500, active=1))[0]
which = patch.place(counter(0, 1))[0]
pick = patch.place(select(0, 1))[0]
low = patch.place("message set low")[0]
high = patch.place("message set high")[0]
listen = patch.place(receive_tilde("low"))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (sine.outs[0], to_low.ins[0]), (saw.outs[0], to_high.ins[0]),
    (clock.outs[0], which.ins[0]), (which.outs[0], pick.ins[0]),
    (pick.outs[0], low.ins[0]), (pick.outs[1], high.ins[0]),
    (low.outs[0], listen.ins[0]), (high.outs[0], listen.ins[0]),
    (listen.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("receive_tilde")
