# Gen Support for MaxPyLang

## Overview

Add comprehensive Gen operator support to MaxPyLang, covering both the outer gen objects (gen~, jit.gen, jit.pix, jit.gl.pix) and the inner gen operators (history, param, cycle, in, out, delay, etc.) that live inside gen patchers.

Users will be able to create gen patchers using the same `place()`/`connect()` API they already use for regular Max patches, and embed them inside gen~ objects in a parent patch.

## Gen Operator Catalog

### Source Data

Local Max reference files at `/Applications/Max.app/Contents/Resources/C74/docs/userguide/content/gen/`:

- `gen_common_operators.json` — 150 operators common to all gen variants
- `gen~_operators.json` — 63 operators specific to gen~ (audio-rate)
- `gen_jitter_operators.json` — 30 operators specific to jit.gen/jit.pix/jit.gl.pix

Total: 243 operators.

These will be cross-referenced with the Cycling '74 online documentation to identify any gaps.

### Common Operators (150)

**Comparison:** !=p, neqp, >, gt, ==, eq, ==p, eqp, >=, gte, >=p, gtep, >p, gtp, <, lt, <=, lte, <=p, ltep, <p, ltp, max, maximum, min, minimum, !=, neq, step

**Constants/Declare:** constant, degtorad, DEGTORAD, e, E, f, float, halfpi, HALFPI, i, int, invpi, INVPI, ln10, LN10, ln2, LN2, log10e, LOG10E, log2e, LOG2E, PHI, phi, pi, PI, radtodeg, RADTODEG, sqrt1_2, SQRT1_2, sqrt2, SQRT2, twopi, TWOPI, param, Param, expr

**I/O:** pass, in, out

**Logic:** !, not, &&, and, bool, or, ||, ^^, xor

**Math:** !%, rmod, !-, rsub, %, mod, +, add, -, sub, /, div, absdiff, cartopol, *, mul, neg, poltocar, !/, rdiv

**Numeric:** abs, ceil, floor, trunc, fract, sign

**Powers:** exp, exp2, fastexp, fastpow, ln, log, log10, log2, pow, sqrt

**Range:** clamp, clip, fold, scale, wrap

**Route:** ?, switch, gate, mix, r, receive, s, send, selector, smoothstep

**Subpatcher:** gen, setparam

**Trigonometry:** acos, acosh, asin, asinh, atan, atan2, atanh, cos, cosh, degrees, fastcos, fastsin, fasttan, hypot, radians, sin, sinh, tan, tanh

**Waveform:** noise

### Gen~ Operators (63)

**Buffer:** buffer, channels, cycle, data, dim, lookup, nearest, peek, poke, sample, splat, wave

**Convert:** atodb, dbtoa, ftom, mstosamps, mtof, sampstoms

**Constants:** fftfullspect, FFTFULLSPECT, ffthop, FFTHOP, fftoffset, FFTOFFSET, fftsize, FFTSIZE, samplerate, SAMPLERATE, vectorsize, VECTORSIZE

**DSP:** fixdenorm, fixnan, isdenorm, isnan, t60, t60time

**Feedback:** delay, history

**FFT:** fftinfo

**Filter/Waveform:** change, dcblock, delta, interp, latch, phasewrap, sah, slide

**Global:** elapsed, mc_channel, mc_channelcount, voice, voicecount

**Integrator:** *=, mulequals, +=, accum, plusequals, counter, round

**Waveform:** phasor, rate, train, triangle

### Jitter Operators (30)

**Color:** hsl2rgb, rgb2hsl

**Coordinate:** cell, dim, norm, snorm

**Quaternion:** qconj, qmul, qrot

**Sampling:** nearest, nearestpix, sample, samplepix

**Surface:** circle, cone, cylinder, plane, sphere, torus

**Vector:** concat, cross, dot, faceforward, length, normalize, reflect, refract, rotor, swiz, vec

## Gen Patcher Infrastructure

### How Gen Patchers Work in Max JSON

A gen~ object in a .maxpat file contains a nested patcher dictionary. Example structure:

```json
{
  "box": {
    "id": "obj-1",
    "maxclass": "newobj",
    "text": "gen~",
    "patcher": {
      "classnamespace": "dsp.gen",
      "fileversion": 1,
      "rect": [0.0, 0.0, 600.0, 450.0],
      "boxes": [
        {"box": {"id": "obj-1", "text": "in 1", ...}},
        {"box": {"id": "obj-2", "text": "out 1", ...}}
      ],
      "lines": [
        {"patchline": {"source": ["obj-1", 0], "destination": ["obj-2", 0]}}
      ]
    }
  }
}
```

The `classnamespace` field determines the gen variant:
- `"dsp.gen"` — gen~ (audio-rate)
- `"jit.gen"` — jit.gen (CPU matrix)
- `"jit.pix"` — jit.pix (CPU pixel)
- `"jit.gl.pix"` — jit.gl.pix (GPU pixel)

### MaxPatch Changes

Add a `gen_type` parameter to `MaxPatch`:

```python
gen_patch = mp.MaxPatch(gen_type="dsp.gen")
```

When `gen_type` is set:
- The patcher dict uses a simplified template (no toolbar/statusbar metadata)
- `classnamespace` is set to the given gen type instead of `"box"`
- The patch otherwise works identically — same `place()`, `connect()`, `get_json()`

### Embedding Gen Patchers

Add a `gen_patcher` parameter to `place()`:

```python
gen_obj = patch.place("gen~", gen_patcher=gen_patch)[0]
```

When `gen_patcher` is provided:
- The gen patcher's JSON dict (from `gen_patch.get_json()`) is injected into the placed object's `_dict["box"]["patcher"]` field
- The outer object's `numinlets`/`numoutlets` are set based on the gen patcher's `in`/`out` operators

## File Organization

- `maxpylang/objects/gen.py` — auto-generated stubs for all 243 gen operators
- `maxpylang/objects/__init__.py` — updated to export gen module
- `maxpylang/data/OBJ_INFO/gen/` — metadata JSONs for gen operators
- `maxpylang/maxpatch.py` — updated with `gen_type` parameter
- `maxpylang/tools/patchfuncs/placing.py` — updated `place()` to accept `gen_patcher`
- `maxpylang/__init__.py` — no new exports needed (GenPatch is just MaxPatch with a parameter)
- `docs/gen_operator_comparison.md` — local vs. online operator coverage report

## Scraping & Comparison Workflow

1. Parse the 3 local gen JSON files to extract all operator names, categories, and descriptions
2. Scrape the Cycling '74 online docs for gen operator listings
3. Compare the two sets and output a report documenting:
   - Operators found in both sources
   - Operators only in local files
   - Operators only in online docs
4. Use the combined/complete set to generate `gen.py` and `OBJ_INFO/gen/`

## User API

```python
import maxpylang as mp
from maxpylang.objects import gen

# Create inner gen patcher
gen_patch = mp.MaxPatch(gen_type="dsp.gen")
inp = gen_patch.place("in 1")[0]
cyc = gen_patch.place("cycle")[0]
outp = gen_patch.place("out 1")[0]
gen_patch.connect([inp.outs[0], cyc.ins[0]],
                  [cyc.outs[0], outp.ins[0]])

# Create outer patch and embed gen~
patch = mp.MaxPatch()
gen_obj = patch.place("gen~", gen_patcher=gen_patch)[0]
dac = patch.place("ezdac~")[0]
patch.connect([gen_obj.outs[0], dac.ins[0]])
patch.save("my_gen_patch.maxpat")
```

## Examples

Deferred. Will be added once gen infrastructure is working and example gen patches are provided.
