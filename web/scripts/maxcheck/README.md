# Checking the browser engine against Max

The plugin generator plays a device in the browser and downloads it for Live. These
scripts check that the two sound the same, by rendering one test signal through the same
generated patches in Max and in the browser engine and comparing the recordings.

It needs Max installed (macOS paths below). Nothing is played through the speakers.

```sh
cd web/scripts/maxcheck && mkdir -p out && cd out
python ../make_signal.py signal.wav
python ../tests.py                                  # writes tests.json

# Max: one patch, every test, about half a minute. Max opens, records and quits.
python ../max_batch.py tests.json "$PWD/signal.wav" 10.3 "$PWD/max"
open -W -a Max max/batch.maxpat

# Browser: headless Chromium against the dev server.
python ../web_patches.py tests.json web_patches.json
python ../server.py . &                             # port 8766
(cd ../../.. && npm run dev) &                      # port 5173
node ../headless.mjs web_patches.json signal.wav web

python ../analyze.py max                            # what each effect does, in Max
python ../compare.py max web                        # browser minus Max
```

## What it found

Measured in Max 9.1.5 at 44.1 kHz, and now built into the engine and the generator:

| Object | What Max does |
|---|---|
| `overdrive~` | `y = sign(x) * (1 - (1 - abs(x)) ^ drive)`, flat past full scale |
| `svf~` | frequency coefficient `sin(2*pi*fc/sr)`; damping `(1.2 * (1 - res))^2`, capped at 1; cutoff up to sr/4 |
| `onepole~` | `y += g * (x - y)`, `g = 1 - exp(-2*pi*fc/sr)`; cutoff up to sr/4 |
| `degrade~` | rounds down, not to nearest; takes a sample, then advances its phase, in single precision |
| `comb~`, `allpass~` | a delay given as a number is cut down to whole samples |
| `comb~` | a delay given as a signal is read between samples (linear) |
| `tanh~`, `clip~`, `pong~ 0` | the plain math: tanh, clip, fold |

With those in place the browser matches Max to the last bit of a 16-bit recording for
the filter, every distortion type, the delay, the flanger and the reverb.

What still differs, and why it is left alone:

- **Chorus, flanger and tremolo sweeps** start wherever their LFO happens to be. In Max
  the `cycle~` has been running since audio was switched on.
- **`degrade~` at low rates** holds different samples for the same reason: its phase
  free-runs.
- **A `tapout~` with a signal time and no feedback** reads 64 samples (one signal vector)
  early in Max, so the chorus sits 1.5 ms closer than its dial says. The browser uses
  the time as written.
- **A ping-pong delay** has the same 64 samples in one of its two hops in Max.

One thing was the browser's, not Max's: Chrome runs every feedback cycle one render
quantum (128 samples) late. `tapout~` now offers an early read for cords that close a
loop (`loopOuts` in `engine/registry.ts`), and `comb~` is a worklet with its loop inside.
