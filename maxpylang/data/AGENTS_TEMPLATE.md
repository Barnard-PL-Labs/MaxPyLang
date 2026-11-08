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
whatever its form: each one raises a `ConnectionWarning` at the line that made it, and
`save()` ends with a `PatchCheck: cords` line counting them. The cord is still saved, so fix
every warning before using the patch.

## Core API

### MaxPatch

```python
patch = mp.MaxPatch(template=None, load_file=None, reorder=True, verbose=True)
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
patch.connect(*connections, verbose=True)
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
```

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
- `verbose=False` suppresses console output
- Inlet/outlet indices are **0-based**
- **Typos raise `UnknownObjectWarning`** — if you see this warning, fix the object name immediately. The object will have 0 inlets/outlets and won't work. Use `obj.notknown()` to check programmatically.
- **Audio into a message-only inlet raises `ConnectionWarning`**, e.g. `cycle~` straight into a `flonum` or `metro`. Max keeps such a cord but it does not work. Fix every one, usually by putting `snapshot~` (audio to numbers) or `jit.catch~` (audio to Jitter) in between. `save()` ends with a `PatchCheck: cords` line counting them.

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
