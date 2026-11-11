"""Max for Live audio effect: a tremolo on both channels."""
import maxpylang as mp
from maxpylang.objects import clip_tilde, cycle_tilde, plugin_tilde, plugout_tilde

patch = mp.MaxPatch(verbose=False)

patch.set_position(30, 30)
src = patch.place(plugin_tilde)[0]    # from Live; outlets 0 and 1 are left and right

# LFO: cycle~ swings -1..1; scale it to 0..1 for a volume control.
patch.set_position(200, 30)
lfo = patch.place(cycle_tilde(4))[0]
patch.set_position(200, 90)
half = patch.place("*~ 0.5")[0]
patch.set_position(200, 150)
offset = patch.place("+~ 0.5")[0]

patch.set_position(30, 210)
left, right = patch.place("*~", num_objs=2, spacing=[80, 0])
patch.set_position(30, 270)
safe_l, safe_r = patch.place(clip_tilde(-1.0, 1.0), num_objs=2, spacing=[80, 0])
patch.set_position(30, 330)
out = patch.place(plugout_tilde)[0]

patch.connect(
    (lfo.outs[0], half.ins[0]),
    (half.outs[0], offset.ins[0]),
    (src.outs[0], left.ins[0]),
    (src.outs[1], right.ins[0]),
    (offset.outs[0], left.ins[1]),     # audio into the right inlet of *~ sets the gain
    (offset.outs[0], right.ins[1]),
    (left.outs[0], safe_l.ins[0]),
    (right.outs[0], safe_r.ins[0]),
)
patch.connect((safe_l.outs[0], out.ins[0]), (safe_r.outs[0], out.ins[1]))

patch.save("tremolo.amxd", device_type="audio_effect")
