"""Recording two channels
mc.record~ records a multichannel signal into a buffer~. Click the toggle on to record two sines into take (2 seconds, 2 channels) and off to stop; you hear them as they record.
"""
import maxpylang as mp
from maxpylang.objects import buffer_tilde, loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_record_tilde, toggle

patch = mp.MaxPatch()
take = patch.place(buffer_tilde("take", "@samps", 88200, "@chans", 2))[0]
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 220 330")[0]
osc = patch.place(mc_cycle_tilde(220))[0]
rec_on = patch.place(toggle)[0]
rec = patch.place(mc_record_tilde("take"))[0]
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], osc.ins[0]),
    (osc.outs[0], rec.ins[0]),
    (rec_on.outs[0], rec.ins[0]),     # 1 starts, 0 stops
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_record")
