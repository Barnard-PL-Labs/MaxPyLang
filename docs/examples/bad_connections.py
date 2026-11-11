"""Mistakes a type checker catches. Every line ending in `# error` is flagged by
mypy, pyright and ty; the docs build checks that. Do not run this file with python."""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, flonum, toggle

patch = mp.MaxPatch()
osc = patch.place(cycle_tilde(440))[0]
num = patch.place(flonum)[0]
tog = patch.place(toggle)[0]
dac = patch.place(ezdac_tilde)[0]

patch.connect((osc.outs[0], num.ins[0]))  # error
patch.connect((osc.outs[0], tog.ins[0]))  # error
patch.connect((osc.outs[0], dac.ins[2]))  # error
patch.connect((osc.outs[0], dac.ins[0]))
