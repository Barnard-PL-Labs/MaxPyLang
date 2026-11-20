"""Playing a movie
jit.movie reads a movie file and, on each bang, sends out the current frame. A metro bangs it 30 times a second and jit.pwindow shows the frames. crashtest.mov comes with Max.
"""
import maxpylang as mp
from maxpylang.objects import jit_movie, jit_pwindow, loadbang, metro

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
file = patch.place("message read crashtest.mov")[0]
clock = patch.place(metro(33, active=1))[0]
movie = patch.place(jit_movie)[0]
screen = patch.place(jit_pwindow)[0]

patch.connect(
    (start.outs[0], file.ins[0]),
    (file.outs[0], movie.ins[0]),
    (clock.outs[0], movie.ins[0]),
    (movie.outs[0], screen.ins[0]),
)
patch.save("movie")
