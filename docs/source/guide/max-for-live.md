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
| `"instrument"`   | a MIDI track                     | `midiin` → `midiparse`, or `notein` | `plugout~`    |
| `"audio_effect"` | an audio track, after a device   | `plugin~`               | `plugout~`                |
| `"midi_effect"`  | a MIDI track, before an instrument | `midiin` → `midiparse` | `midiformat` → `midiout`  |

- Setting `device_type` always writes `.amxd`; `save("synth", device_type="instrument")` writes
  `synth.amxd`.
- Saving a `.amxd` name without `device_type` raises `ValueError`.
- `mp.MaxPatch(load_file="device.amxd")` loads a device to edit, if it was saved unfrozen
  and has no UI objects; see {doc}`known-issues`.

## Live's I/O, not Max's

In a device, audio comes from and goes to Live's track, not the sound card:

| In a Max patch | In a device | Why                                         |
|----------------|-------------|---------------------------------------------|
| `ezdac~`, `dac~` | `plugout~` | Output goes to the track's mixer           |
| `adc~`, `ezadc~` | `plugin~`  | Input comes from the track                 |
| a toggle on `ezdac~` | nothing | Live runs audio; the device is always on   |

`plugin~` has two outlets and `plugout~` two inlets: left and right. Connect both for stereo.

A `clip~ -1. 1.` before `plugout~` is an optional safety net while you experiment: it stops a
mistake from sending very loud audio to Live. Cycling '74's own devices do not use one.

:::{note}
Live's own UI objects (`live.dial`, `live.slider`, `live.numbox`, `live.gain~`) are not yet in
maxpylang's object data. Placing one gives an unknown object with no inlets or outlets, so it
cannot be connected. Use `dial`, `slider` or `number` for now, and swap in the `live.*`
objects in Max after generating the device. See {doc}`known-issues`.
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

`midiparse` splits raw MIDI by kind, one outlet each, and `midiformat` builds MIDI from the
same kinds, one inlet each, in nearly the same order. The first of each carries notes as a
two-item list, pitch then velocity; the second is poly key pressure, not velocity. So to change
notes, unpack the list, change it, and pack it again before `midiformat`:

```{literalinclude} ../../examples/m4l_midi_effect.py
:language: python
```

| Port | `midiparse` outlet                   | `midiformat` inlet                      |
|------|--------------------------------------|-----------------------------------------|
| 0    | notes: list (pitch, velocity)        | notes: list (pitch, velocity)           |
| 1    | poly key pressure: list (key, value) | poly key pressure: list (value, key)    |
| 2    | control change: list (number, value) | control change: list (number, value)    |
| 3    | program change                       | program change                          |
| 4    | aftertouch                           | aftertouch                              |
| 5    | pitch bend                           | pitch bend                              |
| 6    | MIDI channel                         | MIDI channel (sets it, sends nothing)   |
| 7    | `midievent` message                  |                                         |

Note that poly key pressure is in opposite orders. The `unpack` → `pack` pattern works because
`unpack` sends its rightmost element first, so velocity is waiting in `pack` before pitch
arrives and sends the pair.

## Without a MaxPatch

`save_amxd` and `load_amxd` convert between a `.amxd` file and the patch's JSON, for when you
change the JSON yourself:

```python
from maxpylang import save_amxd, load_amxd

data = load_amxd("sine_instrument.amxd")      # the patcher JSON as a dict
save_amxd(data, "copy.amxd", device_type="instrument")
```

A `.amxd` file written by maxpylang is the same JSON as a `.maxpat`, wrapped in three binary
chunks: `ampf` (the device type: `aaaa`, `iiii` or `mmmm`), `meta` (maxpylang writes zeros), and
`ptch` (the JSON). Devices Max saves *frozen* store a binary container in `ptch` instead, which
these functions cannot read; see {doc}`known-issues`.
