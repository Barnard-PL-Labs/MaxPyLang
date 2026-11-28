# MaxPyLang

> Written by `maxpylang setup-agent`. It tells coding agents how to use the MaxPyLang API.
> Run `maxpylang setup-agent` (or `python -m maxpylang setup-agent`) again after upgrading
> maxpylang; it replaces only this block.

Python library for programmatically creating and editing Max/MSP patches (`.maxpat` files).

## Quick Start

```python
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde

patch = mp.MaxPatch()
osc = patch.place(cycle_tilde(440))[0]
dac = patch.place(ezdac_tilde)[0]
patch.connect((osc.outs[0], dac.ins[0]), (osc.outs[0], dac.ins[1]))
patch.save("hello_world")
```

Write patches in this form: objects from `maxpylang.objects`, and `(outlet, inlet)` tuples
in `connect()`. A type checker can then check every connection (see
[Check before you run](#check-before-you-run)).

## Check before you run

Before running a script, run a type checker on it and fix every error it reports:

```bash
pip install pyright
pyright my_patch.py
```

(`mypy my_patch.py` also works; its message for a bad cord is less clear.)

It catches, before anything runs:

- **Audio into an inlet that takes only messages**, e.g. `cycle~` into `flonum` or `metro`.
  Put `snapshot~` between them to turn audio into numbers.
- **An inlet or outlet index that does not exist**, e.g. `flonum` has 1 inlet, so
  `num.ins[1]` is an error.

A type checker only sees objects placed from `maxpylang.objects` and connections written as
tuples. Running the script checks audio into a message-only inlet for every connection,
whatever its form: each one raises a `ConnectionWarning` at the line that made it. The cord
is still saved, so fix every warning before using the patch.

A script prints nothing while it builds the patch. Problems are warnings, printed (to stderr)
when they happen, at the line that caused them. `save()` then prints one line counting them:

```
saved hello_world.maxpat (2 objects, 1 cord, no problems found)
saved feedback.maxpat (4 objects, 4 cords, 1 problem, see warning above)
```

Anything other than `no problems found` means there is a warning to fix. When output is
piped, the warnings can appear before lines printed earlier, so read the whole output, not
only its end. For the full per-check report, call `patch.check()`.

`save()` also checks the messages on the cords, and raises a `MessageWarning` for each:

- **A message the object has no method for**, e.g. a message box `reset` into a `counter`
  (it takes `bang`, a number, `set`, `goto`, `min`, `max`...). Max would print
  `counter: doesn't understand 'reset'` and do nothing. Send a message the object takes.
- **An object that answers before its right inlet has the new value.** An object like `+`
  answers when its left inlet gets a value, using what its right inlet last got. When one
  outlet feeds both, Max sends to the box placed further right first, so the layout decides
  the result. Do not rely on positions: use a `trigger`, whose outlets fire right to left.

  ```python
  import maxpylang as mp

  patch = mp.MaxPatch()
  num = patch.place("number")[0]
  order = patch.place("t f f")[0]              # right outlet fires first
  double = patch.place("* 2")[0]
  add = patch.place("+")[0]
  out = patch.place("print")[0]
  patch.connect((num.outs[0], order.ins[0]),
                (order.outs[1], double.ins[0]),   # first: set the right inlet of +
                (double.outs[0], add.ins[1]),
                (order.outs[0], add.ins[0]),      # then: the left inlet makes it answer
                (add.outs[0], out.ins[0]))
  patch.save("ordered")
  ```
- **An object fed only on its right inlets**, e.g. a `+` with a cord into its right inlet
  and none into its left. Only the left inlet makes it answer, so it never sends anything.
- **A float cut down to a whole number.** An operator works in whole numbers or in floats
  by its argument, whatever it is sent: `* 100` and `*` drop the fraction, `* 100.` keeps
  it. So `live.dial`'s 0 to 1 outlet into `* 100` gives 0 or 100 and nothing between. Write
  the argument with a decimal point (`* 100.`, `/ 127.`, `> 0.`) whenever floats arrive.
  `scale 0 127 0 1` has the same trap: with four whole-number arguments it sends whole
  numbers only. Write `scale 0 127 0. 1.`.

`save()` knows what a MIDI input sends (`notein`, `ctlin`, `bendin`, `touchin` and `kslider`
send 0 to 127, `xbendin` 0 to 16383) and raises a `MessageWarning` when that range does not
suit where it goes:

- **A velocity straight into `adsr~`.** `adsr~` takes the number that triggers it as the
  envelope's amplitude, so a velocity of 100 is 100 times full scale. Put `/ 127.` between.
- **`bendin` scaled as 14 bits.** `bendin` sends 0 to 127 with 64 in the middle. Use
  `scale 0 127 -2. 2.`, or `xbendin` for 0 to 16383.
- **`gate` with its cords swapped.** The left inlet opens and closes the gate (0 closes it)
  and the right inlet takes what passes through. A pitch into the left and a 0/1 flag into
  the right is the wrong way round.
- **`live.tab` straight into `selector~`.** A tab or menu counts its items from 0, while
  `selector~`, `gate` and `switch` count from 1 and take 0 as "off". Put `+ 1` between.
- **A number out of an inlet's range**, such as a velocity into a resonance inlet that
  takes 0 to 1.

Two things Max accepts as typed and then does not do, which `save()` also warns about:

- **An envelope for `line~` is one message.** A comma in a message box ends a message, so
  `1 40, 0 160` sends two ramps at once and the second replaces the first: no attack. Write
  `0, 1 40 0 160`: a jump to 0, then pairs of a value and the time to reach it.
- **`jit.expr` reads `@expr`, and calls its inputs `in[0]`, `in[1]`.** Write
  `jit.expr @expr in[0]*0.5`, with one expression for each plane. `in1` and `out1` are
  jit.gen's names, and an expression typed without `@expr` is read as plane count and type.

`save()` also checks that the patch starts, and raises a `GraphWarning` for each of these.
Every cord in such a patch is legal, and it still does nothing:

- **An object that only sends when it gets a bang, with no bang coming.** `jit.grab`,
  `jit.movie`, `jit.catch~`, `jit.noise` and `transport` send nothing on their own. Connect
  a `qmetro 33 @active 1` to the left inlet. A toggle into `transport` starts the clock, but
  it still reports its tempo and position only on a bang.
- **A clock that is never switched on.** `metro`, `qmetro`, `tempo` and `clocker` need a
  toggle or `loadmess 1` in the left inlet. `metro`, `qmetro` and `clocker` also start with
  `@active 1` in the box. `tempo` has no such attribute.
- **A `jit.world` that is never enabled.** Write `jit.world @enable 1`. A `loadbang` into it
  draws one frame and stops.
- **A picture that is loaded and never sent.** `importmovie` loads a file into a `jit.matrix`
  and sends nothing. Follow it with a bang: a message box `importmovie picture.png, bang`.
- **A `groove~` with no speed.** `groove~` plays at the speed of the audio signal in its left
  inlet. Connect `sig~ 1.` there. A number there sets where it plays from, not how fast.
  `set` takes a buffer name, so `set 0` does not rewind: send `0` alone.
- **A `waveform~` with no buffer.** Write `waveform~ @buffername mybuffer`.
- **A `poly~` whose voices all get the same note.** A plain list into `poly~` goes to every
  voice. Use `prepend note` to give it to one free voice, and `thispoly~` in the voice to
  mark it busy. The list arrives whole at the voice's `in 1`: `unpack` it there. It is not
  split across `in 1`, `in 2`.
- **`inlet` or `outlet` in a file that a `poly~` or `pfft~` loads.** In a `poly~` only `in`,
  `in~`, `out` and `out~` make inlets and outlets. In a `pfft~` audio comes in and out
  through `fftin~` and `fftout~`, and messages through `in` and `out`.

A check says nothing about what it does not know. When some of the patch could not be judged,
the `save()` line ends with how many objects were not checked, e.g. `1 object not checked`, and
`patch.check()` names them: `not checked:` names the unknown objects and abstractions behind
cords the cord check skipped, and `not seen into:` names the objects the whole-patch check
treats as able to do anything (subpatchers, abstractions, `js`, unknown objects). No warning on those
parts does not mean they work. `patch.get_coverage()` returns the same numbers as a dict, and
also names the known objects whose cords were skipped because maxpylang has no type data for
them.

## Core API

### MaxPatch

```python
patch = mp.MaxPatch(template=None, load_file=None, reorder=True, verbose=False)
```

- `template` — path to a `.maxpat` template file
- `load_file` — path to an existing `.maxpat` or `.amxd` to load and modify

**Methods:**

```python
patch.place(*objs, num_objs=1, spacing_type="grid", spacing=[80,80],
            starting_pos=None, verbose=False) -> list[MaxObject]
```
Places objects in the patch. Always returns a **list** — use `[0]` for a single object.

```python
patch.connect(*connections, verbose=False)
```
Each connection is an `(outlet, inlet)` tuple: `patch.connect((obj1.outs[0], obj2.ins[0]))`.

```python
patch.save(filename="default.maxpat", device_type=None, verbose=True, check=True)
```
Auto-appends `.maxpat` if missing. For Max for Live: `patch.save("device.amxd", device_type="instrument")`.

```python
patch.set_position(new_x, new_y)
```
Moves the internal cursor for next placement.

**Properties:** `patch.objs` (dict), `patch.num_objs` (int), `patch.curr_position` (list)

### MaxObject

```python
obj = mp.MaxObject("cycle~ 440")
obj = mp.MaxObject("metro 500 @active 1")   # with attributes
```

**Properties:**
- `obj.name` — object class name (e.g. `"cycle~"`)
- `obj.ins` — list of Inlets (0-indexed)
- `obj.outs` — list of Outlets (0-indexed)

**Methods:**
```python
obj.edit(text_add="append", text=None, **extra_attribs)  # modify object
obj.move(x, y)                                           # reposition
obj.parameter(name, lo, hi, initial=..., unit=...)       # a Live parameter's name and range
```

`edit()` and `place()` raise an `AttributeWarning` for an attribute the object does not have,
and leave it out. Every box takes the common ones: `presentation`, `presentation_rect`,
`hidden`, `varname`, `annotation`, `hint`, `background`.

### Connections

Inlets and outlets are 0-indexed. Wire them with `connect()`:

```python
patch.connect((src.outs[0], dst.ins[0]))          # single connection
patch.connect((a.outs[0], b.ins[0]),
              (b.outs[0], c.ins[0]))               # multiple connections
```

Always connect the object `place()` returned, never the stub itself:
`patch.connect((cycle_tilde.outs[0], ...))` raises.

## Stub Objects

One stub per Max object, for autocomplete and type checking:

```python
from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, toggle
```

**Naming rules:**
| Max name | Python name | Rule |
|----------|------------|------|
| `cycle~` | `cycle_tilde` | `~` becomes `_tilde` |
| `jit.movie` | `jit_movie` | `.` becomes `_` |
| `live.dial` | `live_dial` | `-` becomes `_` |
| `2d.wave~` | `_2d_wave_tilde` | leading digit gets `_` prefix |
| `in` | `in_` | Python keyword gets `_` suffix |

Pass a stub to `place()`, or call it to give arguments and attributes. Each `place()`
makes a new object, so the same stub can be placed many times:

```python
dac = patch.place(ezdac_tilde)[0]               # no arguments
osc = patch.place(cycle_tilde(440))[0]          # "cycle~ 440"
met = patch.place(metro(500, active=1))[0]      # "metro 500 @active 1"
```

Operators have stubs under their spelled-out Max names: `*~` is `times_tilde`, `+~` is
`plus_tilde`, `+` is `plus`. Use string syntax (`patch.place("cycle~ 440")`) only for an
object with no stub; its connections are not type-checked.

## Available Objects

All valid object names are listed in `maxpylang/objects/` (stubs organized by package: `max.py`, `msp.py`, `jit.py`). Use these as the source of truth for valid names. The matching `.pyi` files give each object's exact inlets and outlets, and whether each carries audio or messages.

**Common objects by category:**

| Category | Objects |
|----------|---------|
| Audio sources | `cycle~`, `noise~`, `pink~`, `rect~`, `saw~`, `tri~`, `phasor~` |
| Audio I/O | `adc~`, `dac~`, `ezdac~`, `ezadc~` |
| Audio processing | `gain~`, `lores~`, `reson~`, `biquad~`, `delay~`, `tapin~`, `tapout~` |
| Math (audio) | `+~`, `*~`, `-~`, `/~`, `clip~`, `abs~`, `scale~` |
| Control | `metro`, `counter`, `toggle`, `button`, `number`, `flonum`, `dial` |
| Routing | `gate`, `switch`, `route`, `select`, `trigger`, `pack`, `unpack` |
| Data | `coll`, `dict`, `table`, `buffer~`, `preset` |
| MIDI | `notein`, `noteout`, `ctlin`, `ctlout`, `midiin`, `midiout` |
| UI | `multislider`, `slider`, `comment`, `message`, `panel`, `live.dial` |
| Timing | `delay`, `pipe`, `timer`, `transport`, `tempo` |
| Math (control) | `+`, `*`, `-`, `/`, `%`, `random`, `drunk`, `scale` |

## Common Patterns

### Audio chain

```python
from maxpylang.objects import cycle_tilde, gain_tilde, ezdac_tilde

patch = mp.MaxPatch()
osc = patch.place(cycle_tilde(440))[0]
gain = patch.place(gain_tilde)[0]
dac = patch.place(ezdac_tilde)[0]
patch.connect((osc.outs[0], gain.ins[0]),
              (gain.outs[0], dac.ins[0]),
              (gain.outs[0], dac.ins[1]))
patch.save("audio_chain")
```

### Multiple objects with loops

```python
from maxpylang.objects import toggle, gate

n = 10
toggles = patch.place(toggle, num_objs=n, starting_pos=[0, 100])
gates = patch.place(gate, num_objs=n, starting_pos=[0, 200])

for t, g in zip(toggles, gates):
    patch.connect((t.outs[0], g.ins[0]))
```

### Attributes

Keyword arguments to a stub become attributes:

```python
from maxpylang.objects import metro, jit_movie

patch.place(metro(500, active=1))[0]                 # "metro 500 @active 1"
patch.place(jit_movie(moviefile="crashtest.mov"))[0] # "jit.movie @moviefile crashtest.mov"
```

On a UI object (a `slider`, a `flonum`, a `waveform~`) an attribute in the text also sets the
property of the box that Max reads: `patch.place("slider @size 1000")` saves `"size": 1000.0`,
as `mp.MaxObject("slider", size=1000.)` does. An attribute maxpylang does not know raises an
`AttributeWarning` and is kept in the text as written.

### Loading and modifying existing patches

```python
patch = mp.MaxPatch(load_file="existing.maxpat")
for key, obj in patch.objs.items():
    print(obj.name)
patch.save("modified")
```

## Abstractions

For custom Max abstractions (sub-patches) that don't exist in the current directory:

```python
# Declare abstraction with known I/O — no .maxpat file needed
synth = mp.MaxObject("my_synth", abstraction=True, inlets=2, outlets=2)
placed = patch.place(synth)[0]

# With arguments
synth = mp.MaxObject("my_synth 440 0.5", abstraction=True, inlets=2, outlets=2)

# If the .maxpat file exists in cwd, auto-detection still works
synth = mp.MaxObject("my_synth")
```

- `abstraction=True` — skip file lookup, treat as abstraction
- `inlets` / `outlets` — declare I/O count (default 0 if omitted)
- `notknown()` returns `False` for declared abstractions
- Create the `MaxObject` first, then pass to `place()` (place doesn't forward these kwargs)

## Key Rules

- `place()` **always returns a list** — use `[0]` for single objects
- Write connections as `(outlet, inlet)` tuples, and run a type checker before running the script
- Object names are **case-sensitive** and must match Max names exactly
- Coordinates are floats
- `save()` auto-appends `.maxpat`
- `save()` prints one summary line; `save(verbose=False)` prints nothing. `verbose=True` on `MaxPatch()`, `place()` or `connect()` prints each step. Warnings print either way
- Inlet/outlet indices are **0-based**
- **Typos raise `UnknownObjectWarning`** — if you see this warning, fix the object name immediately. The object will have 0 inlets/outlets and won't work. Use `obj.notknown()` to check programmatically.
- **Audio into a message-only inlet raises `ConnectionWarning`**, e.g. `cycle~` straight into a `flonum` or `metro`. Max keeps such a cord but it does not work. Fix every one, usually by putting `snapshot~` (audio to numbers) or `jit.catch~` (audio to Jitter) in between. The `save()` line counts them among its problems.
- **`save()` raises a `GraphWarning` for problems in the shape of the patch**: a hot loop (a message cycle through hot inlets, which loops without end), audio feedback with no delay (put `tapin~`/`tapout~` in the loop), and objects whose output never reaches an output, display or side effect. Fix every hot loop and feedback loop. A dead output is usually a missing connection, so check each one and connect it or remove the object; leave it only if the object is meant to work with nothing after it.
- **A `tapin~` outlet carries a tap link, not audio.** It goes to a `tapout~` and nowhere else; take the delayed audio from the `tapout~`. Connecting it to anything else raises `ConnectionWarning`, and a `tapout~` with no `tapin~` raises `GraphWarning` at save.
- **Names must have both ends in the patch.** `save()` raises a `GraphWarning` for a `receive` or `receive~` whose name nothing sends to, and for a `groove~`, `play~`, `index~`, `wave~`... whose `buffer~` does not exist. Max accepts these silently and the object outputs nothing, so the cause is almost always a typo: make the two names match exactly.

## Patch Layout

Call `set_position(x, y)` **before every `place()` call**. Without it, objects pile up and cords cross.

```python
Y_STEP = 40       # between objects in a chain
SECTION_GAP = 80  # between logical sections
COL_WIDTH = 150   # between parallel columns

patch.set_position(30, 100)
osc = patch.place(cycle_tilde)[0]

patch.set_position(30, 140)          # +Y_STEP
filt = patch.place(lores_tilde)[0]

patch.set_position(30 + COL_WIDTH, 100)  # parallel column
lfo = patch.place(cycle_tilde(2))[0]
```

**Rules:**
- Top-to-bottom signal flow (increasing `y`)
- Parallel chains side by side (same `y`, different `x`)
- Labels (`comment`) 20px above their object
- Section headers: `patch.place("comment === SECTION NAME ===")`
- `loadbang`/defaults to the right of main flow
- Group `connect()` calls by section, not scattered throughout

## Max for Live (.amxd) Devices

MaxPyLang can save patches as Max for Live devices for use in Ableton Live.

### The `device_type` Flag

The `device_type` parameter on `save()` is the **explicit signal** for building M4L devices:

```python
# Regular Max patch (default)
patch.save("my_patch")                                        # → .maxpat

# M4L Instrument (MIDI in, audio out)
patch.save("my_synth.amxd", device_type="instrument")         # → .amxd

# M4L Audio Effect (audio in, audio out)
patch.save("my_reverb.amxd", device_type="audio_effect")      # → .amxd

# M4L MIDI Effect (MIDI in, MIDI out)
patch.save("my_arp.amxd", device_type="midi_effect")          # → .amxd
```

When `device_type` is set, the extension is forced to `.amxd`. When saving `.amxd` without `device_type`, a `ValueError` is raised.

### Device Types and I/O Objects

Each device type requires specific I/O objects. **Use these instead of `ezdac~`/`adc~`:**

| `device_type` | Input object | Output object | Ableton track |
|---------------|-------------|---------------|---------------|
| `"instrument"` | `notein` | `plugout~` | MIDI track |
| `"audio_effect"` | `plugin~` | `plugout~` | Audio track / after instrument |
| `"midi_effect"` | `midiin` → `midiparse` | `midiformat` → `midiout` | Before instrument on MIDI track |

### I/O Substitution Rules

| Regular Max | Max for Live | Why |
|---|---|---|
| `ezdac~` | `plugout~` | Audio output routes to Ableton's mixer |
| `adc~` | `plugin~` | Audio input comes from the track's signal chain |
| `toggle` on `ezdac~` | Nothing — always on | Ableton controls the audio engine |
| `dial`, `slider` | `live.dial`, `live.slider` | Exposes parameters to Ableton for automation |

### Signal Flow Patterns

**Instrument** (MIDI → audio):
```
notein → mtof → cycle~ → clip~ -1. 1. → plugout~
```

**Audio Effect** (audio → audio):
```
plugin~ → [processing] → clip~ -1. 1. → plugout~
```

**MIDI Effect** (MIDI → MIDI):
```
midiin → midiparse → [processing] → midiformat → midiout
```

### Parameters

A `live.dial`, `live.slider` or `live.numbox` runs 0 to 127 until it is told otherwise.
Give every one a name and a range with `parameter()`, right after placing it:

```python
plug_in = patch.place(plugin_tilde)[0]
filt = patch.place("svf~ 1000. 0.5")[0]
limit = patch.place("clip~ -1. 1.")[0]
plug_out = patch.place(plugout_tilde)[0]

cutoff = patch.place(live_dial)[0]
cutoff.parameter("Cutoff", 40, 11000, initial=1000, unit="hertz", exponent=3)
reso = patch.place(live_dial)[0]
reso.parameter("Resonance", 0, 1, initial=0.5)

patch.connect((plug_in.outs[0], filt.ins[0]),
              (cutoff.outs[0], filt.ins[1]), (reso.outs[0], filt.ins[2]),
              (filt.outs[0], limit.ins[0]),
              (limit.outs[0], plug_out.ins[0]), (limit.outs[0], plug_out.ins[1]))
patch.save("my_filter.amxd", device_type="audio_effect")
```

- `name` is what Live shows and automates by. It must be the only parameter of that name.
- `unit` is one of `"hertz"`, `"decibel"`, `"time"` (ms), `"percent"`, `"pan"`, `"semitones"`,
  `"midi"`, `"int"`, `"float"`. `exponent=3` gives a frequency dial more travel at the low end.
- `integer=True` for whole numbers. `options=["Low", "Band", "High"]` in place of a range for
  a `live.tab` or `live.menu`.
- A wrong call raises: an empty range, a start value outside it, an unknown unit, or an
  object that cannot be a parameter.

### What `save()` checks in a device

Each of these raises a `DeviceWarning` (a kind of `GraphWarning`). Fix every one.

- **The device lacks what its type needs**: an audio effect with no `plugin~`, an instrument
  or MIDI effect with no MIDI input, no `plugout~`, a MIDI effect with no MIDI output.
- **Nothing limits the level reaching `plugout~`**: a gain above 1, two signals added, a
  filter or a feedback loop, with no `clip~ -1. 1.` after it.
- **Two parameters share a name.**
- **A parameter has no cords**, so it shows in Live and controls nothing.
- **A parameter's range does not fit the inlet it reaches**, e.g. a dial that runs 0 to 127
  wired straight into `svf~`'s resonance, which takes 0 to 1. Set the range with
  `parameter()`, or put a `scale` between them.

### M4L Key Rules

- **Always use `clip~ -1. 1.` before `plugout~`** — speaker safety
- **No volume knob needed** — Ableton's mixer handles track volume
- **`plugout~` has 2 inlets** (L/R stereo) — connect both for stereo output
- **`plugin~` has 2 outlets** (L/R stereo) — process both channels

### Loading Existing .amxd Files

```python
patch = mp.MaxPatch(load_file="existing_device.amxd")
for key, obj in patch.objs.items():
    print(obj.name)
patch.save("modified.amxd", device_type="instrument")
```

### Standalone amxd Functions

For advanced use (custom JSON manipulation before saving):

```python
from maxpylang import save_amxd, load_amxd

# Save with custom JSON
json_dict = patch.get_json()
save_amxd(json_dict, "device.amxd", device_type="instrument")

# Load .amxd back to JSON dict
json_dict = load_amxd("device.amxd")
```
