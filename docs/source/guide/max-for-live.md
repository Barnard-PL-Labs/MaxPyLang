---
description: "Save .amxd devices with device_type; Live's I/O objects; instrument and audio effect examples."
---

# Max for Live

A Max for Live device is a patch in a `.amxd` file that runs inside Ableton Live. Build it like
any patch, then save it with a `device_type`:

```python
patch.save("synth.amxd", device_type="instrument")
```

| `device_type`    | Goes on                          | Input objects           | Output objects            |
|------------------|----------------------------------|-------------------------|---------------------------|
| `"instrument"`   | a MIDI track                     | `notein` (or `midiin`)  | `plugout~`                |
| `"audio_effect"` | an audio track, after a device   | `plugin~`               | `plugout~`                |
| `"midi_effect"`  | a MIDI track, before an instrument | `midiin` → `midiparse` | `midiformat` → `midiout`  |

- Setting `device_type` always writes `.amxd`; `save("synth", device_type="instrument")` writes
  `synth.amxd`.
- Saving a `.amxd` name without `device_type` raises `ValueError`.
- `mp.MaxPatch(load_file="device.amxd")` loads a device to edit.

## Live's I/O, not Max's

In a device, audio comes from and goes to Live's track, not the sound card:

| In a Max patch | In a device | Why                                         |
|----------------|-------------|---------------------------------------------|
| `ezdac~`, `dac~` | `plugout~` | Output goes to the track's mixer           |
| `adc~`, `ezadc~` | `plugin~`  | Input comes from the track                 |
| a toggle on `ezdac~` | nothing | Live runs audio; the device is always on   |

`plugin~` has two outlets and `plugout~` two inlets: left and right. Connect both for stereo.
Put `clip~ -1. 1.` before `plugout~` to keep the output in range.

:::{note}
Live's own UI objects (`live.dial`, `live.slider`, `live.numbox`, `live.gain~`) are not yet in
maxpylang's object data. Placing one gives an unknown object with no inlets or outlets, so it
cannot be connected. Use `dial`, `slider` or `number` for now, or add the `live.*` objects
in Max after generating the device.
:::

## Instrument

```{literalinclude} ../../examples/m4l_instrument.py
:language: python
```

## Audio effect

```{literalinclude} ../../examples/m4l_audio_effect.py
:language: python
```

## MIDI effect

`midiparse` splits raw MIDI by kind, one outlet each, and `midiformat` joins it back, with its
inlets in the same order. The first of each carries notes as a two-item list, pitch then
velocity; the second is poly key pressure, not velocity. So to change notes, unpack the list,
change it, and pack it again before `midiformat`:

```{literalinclude} ../../examples/m4l_midi_effect.py
:language: python
```

| `midiparse` outlet / `midiformat` inlet | Carries                              |
|-----------------------------------------|--------------------------------------|
| 0                                       | notes: list (pitch, velocity)        |
| 1                                       | poly key pressure: list (key, value) |
| 2                                       | control change: list (number, value) |
| 3                                       | program change                       |
| 4                                       | aftertouch                           |
| 5                                       | pitch bend                           |
| 6                                       | MIDI channel                         |

## Without a MaxPatch

`save_amxd` and `load_amxd` convert between a `.amxd` file and the patch's JSON, for when you
change the JSON yourself:

```python
from maxpylang import save_amxd, load_amxd

data = load_amxd("sine_instrument.amxd")      # the patcher JSON as a dict
save_amxd(data, "copy.amxd", device_type="instrument")
```

A `.amxd` file is the same JSON as a `.maxpat`, wrapped in three binary chunks: `ampf` (the
device type), `meta` (empty), and `ptch` (the JSON).
