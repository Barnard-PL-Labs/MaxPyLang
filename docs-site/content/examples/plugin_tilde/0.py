"""An audio effect on a track
plugin~ is where a Max for Live audio effect hears its track, left and right; plugout~ sends the result back. Here the track is a guitar loop, and overdrive~ distorts it. Press ▶, then drag the dial to drive it harder.
"""
import maxpylang as mp
from maxpylang.objects import dial, overdrive_tilde, plugin_tilde, plugout_tilde, scale

patch = mp.MaxPatch()
track = patch.place(plugin_tilde)[0]          # the guitar, left and right
knob = patch.place(dial)[0]
drive = patch.place(scale(0, 127, 1.0, 12.0))[0]
fuzz_l = patch.place(overdrive_tilde(3))[0]   # drive 3 until you turn the dial
fuzz_r = patch.place(overdrive_tilde(3))[0]
quiet_l = patch.place("*~ 0.5")[0]
quiet_r = patch.place("*~ 0.5")[0]
out = patch.place(plugout_tilde)[0]           # back to the track

patch.connect(
    (track.outs[0], fuzz_l.ins[0]), (track.outs[1], fuzz_r.ins[0]),
    (knob.outs[0], drive.ins[0]), (drive.outs[0], fuzz_l.ins[1]), (drive.outs[0], fuzz_r.ins[1]),
    (fuzz_l.outs[0], quiet_l.ins[0]), (fuzz_r.outs[0], quiet_r.ins[0]),
    (quiet_l.outs[0], out.ins[0]), (quiet_r.outs[0], out.ins[1]),
)
patch.save("fuzz.amxd", device_type="audio_effect")
