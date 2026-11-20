"""An echo, in samples
delay~ delays a signal by a number of samples. Its first argument (required) is the most it can hold: 44100 samples, one second. Here each pluck repeats 11025 samples (a quarter second) later.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, delay_tilde, ezdac_tilde, line_tilde, metro

patch = mp.MaxPatch()
clock = patch.place(metro(1000, active=1))[0]
shape = patch.place("message 1 5 0 150")[0]
env = patch.place(line_tilde)[0]
osc = patch.place(cycle_tilde(660))[0]
amp = patch.place("*~ 0.")[0]              # times the envelope (silent until it rises)
echo = patch.place(delay_tilde(44100, 11025))[0]   # max samples, delay samples
mix = patch.place("+~")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], shape.ins[0]),
    (shape.outs[0], env.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),
    (amp.outs[0], mix.ins[0]),         # the dry pluck
    (amp.outs[0], echo.ins[0]),
    (echo.outs[0], mix.ins[1]),        # plus its echo
    (mix.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("echo")
