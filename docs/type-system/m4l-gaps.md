# Max for Live gaps

What maxpylang cannot yet **say** or **check** about a Max for Live device.

This log is fed by the plugin generator, a browser page that builds Max for Live audio
effects. It started in this repo's `web/` folder and is now a project of its own. The
generator builds real audio effects with maxpylang, so every time it needs a workaround, or the
checks pass a device that is broken, that is a gap, and it goes here.

## How the loop works

1. **Find.** A gap shows up as a workaround in the generator's `fxgen.py` (a comment
   reading `gap M4L-NN`), or as a broken device that `save()` accepts without a warning.
2. **Log.** It gets an entry below: what is missing, the evidence, a proposed fix.
3. **Pin.** It gets a test in `tests/test_m4l_gaps.py` that states the wanted behaviour
   and is marked `xfail(strict=True)`.
4. **Close.** When the gap is fixed its test starts passing, and strict xfail turns that
   into a failure. That failure is the reminder to remove the mark, set the status here
   to closed, and delete the workaround from `fxgen.py`.

The generator's own tests keep the other end attached: every gap its script names must
be one of the entries in this file.

The page shows the same thing to its users. Its "Type check" panel lists the gaps the
current device had to work around, read off the generated script.

## Summary

| ID | Kind | Gap | Status |
|----|------|-----|--------|
| M4L-01 | express | A dial's range, unit and start value cannot be set | closed |
| M4L-02 | express | Presentation mode has no API and is rejected on some objects | closed |
| M4L-03 | express | A comment is saved with its object name in front of its words | open |
| M4L-04 | express | Patcher settings (open in presentation, device width) have no API | open |
| M4L-05 | check | A tap link is not a type: `tapin~` and `tapout~` pairing is unchecked | closed |
| M4L-06 | check | The device type is not a contract | closed |
| M4L-07 | check | A parameter's range is invisible to the checks | closed for documented inlets |
| M4L-08 | check | Duplicate parameter names are accepted | closed |
| M4L-09 | check | Output level is unbounded: the `clip~` rule is not checked | closed |
| M4L-10 | check | A parameter that controls nothing is accepted | closed |
| M4L-11 | check | About fifty audio objects have an inlet with no type, so cords into them are not judged | closed |

"Express" gaps block the generator and are worked around in its script. "Check" gaps
do not block it: the generator happens to build correct devices, and the checks would
not have noticed if it had not.

---

## M4L-01: a dial's range, unit and start value cannot be set

**Closed.** A `live.dial` is only useful with a range. Max keeps the range, the unit, the
curve and the starting value in the Live parameter block, saved on the box under
`saved_attribute_attributes.valueof`. `edit()` rejected that key with a `print`, so a script
could not set it and could not tell that it had not.

**Fix.** `obj.parameter(name, lo, hi, initial=, unit=, exponent=, short_name=, integer=,
options=)` on every object that can be a parameter. It writes the block Max writes, turns
`parameter_enable` on, and raises on an empty range, a start value outside the range, an
unknown unit, or an object that cannot be a parameter (`cycle~`). `unit` is a `Literal`, so
a type checker rejects a misspelt one before the script runs. `edit()` also accepts a whole
`saved_attribute_attributes` block now.

Separately, an attribute that is dropped is no longer a `print`: `edit()`, `place()` and
`MaxObject()` raise an `AttributeWarning` at the user's line. That surfaced one of
maxpylang's own: `replace()` passed its `verbose` flag on to the object as an attribute.

With ranges first-class, M4L-07, M4L-08 and M4L-10 became checkable, and are closed below.

**Tests.** `test_m4l_01_a_dial_range_can_be_set`,
`test_m4l_01_the_parameter_block_can_also_be_given_whole`,
`test_m4l_01_a_rejected_attribute_is_not_silent`, and `tests/test_devicecheck.py`.

## M4L-02: presentation mode has no API and is rejected on some objects

**Closed.** `edit(presentation=1, presentation_rect=[...])` worked on `live.dial` and was
rejected on `panel`. The difference was whether the object's scraped attribute list held
the `COMMON` marker, which is an accident of the scrape. Presentation is a property of
every box, so every object now takes the common box attributes (`presentation`,
`presentation_rect`, `background`, `hidden`, `varname`, `annotation`...).

There is still no `obj.present(x, y, w, h)` shorthand. `edit()` does the job, so it is not
counted as a gap.

**Test.** `test_m4l_02_any_box_can_be_put_in_presentation`.

## M4L-03: a comment is saved with its object name in front of its words

**Missing.** `patch.place("comment Filter")` should make a comment that reads "Filter".

**Evidence.** The saved box has `"text": "comment Filter"`. Max stores only the words
there: the comments in this repo's own Max-saved examples read `"text": "dry"`,
`"text": "delay"`. The same happens to `live.comment`, and to every UI object, which is
saved with a `text` key holding its own name (`"text": "live.dial"`). For most UI objects
Max ignores the stray key. For the two comment objects `text` is the content, so the
name is displayed. `edit()` also rewrites the key, so setting it by hand has to come
after any `edit()` call, which is how the generator found this.

`CLAUDE.md` recommends `patch.place("comment === SECTION NAME ===")` for section headers,
so this affects ordinary patches, not only devices.

**Workaround.** `obj._dict["box"]["text"] = "Filter"`, after the last `edit()`.

**Proposed fix.** For `comment` and `live.comment`, save the arguments as `text`. For
other UI objects, do not write `text` at all.

**Test.** `test_m4l_03_a_comment_saves_only_its_words` (both objects).

## M4L-04: patcher settings have no API

**Missing.** Two patcher-level keys decide how Live shows a device:
`openinpresentation` (without it Live shows the patching view, squeezed into the device
strip) and `devicewidth`.

**Evidence.** `MaxPatch` has no public method that reaches them. `save()` writes
whatever the template had (`openinpresentation: 0`).

**Workaround.** `patch._patcher_dict["patcher"]["openinpresentation"] = 1`.

**Proposed fix.** Either a general `patch.set_attribs(openinpresentation=1, ...)`, or
have `save(device_type=...)` turn `openinpresentation` on when any box is in
presentation, and compute `devicewidth` from the presentation rects. The test pins the
second option; the first would also close it once the test is adapted.

**Test.** `test_m4l_04_a_device_with_a_presentation_opens_in_it`.

## M4L-05: a tap link is not a type

**Closed.** `tapin~`'s outlet did not carry audio or numbers. It carries a tap link
(Max's `tapconnect`), and the only thing that understands one is `tapout~`. Every delay,
chorus and flanger in a device is built on this pair, and `tapin~ -> *~` was accepted as
a checked, unflagged cord. A `tapout~` fed by no `tapin~` was accepted too, although it
has no line to read and outputs silence.

**Fix.** The tap link is a cord type of its own, `Tap` in `maxpylang/rates.py` and `tap`
in the type table. A `tapin~` outlet sends one, a `tapout~` inlet takes a tap link, audio
or a number, and nothing else takes a tap link. `connect()` warns at the line, and ty,
mypy and pyright reject the same cord in a script written with stubs. At save, a
`tapout~` that no `tapin~` reaches is reported as "no delay line".

Against Max's own shipped patches neither rule flags anything, once a tap link coming in
through an `inlet` or a `poly~` voice's `in` is allowed for.

**Tests.** `test_m4l_05_a_tap_link_only_fits_a_tapout`,
`test_m4l_05_a_tapout_needs_a_tapin`.

## M4L-06: the device type is not a contract

**Closed.** `device_type` says what the device is for, which fixes what it must contain:

| `device_type` | must read | must write |
|---|---|---|
| `audio_effect` | `plugin~` | `plugout~` |
| `instrument` | a MIDI input (`notein`, `midiin`...) | `plugout~` |
| `midi_effect` | a MIDI input | a MIDI output |

An "instrument" that was `cycle~ 440 -> plugout~`, with no MIDI input at all, saved with no
warning. So did an "audio effect" that never read `plugin~`.

**Fix.** `save(device_type=...)` checks the table (`_contract` in
`maxpylang/devicecheck.py`) and raises a `DeviceWarning` for each missing end, naming the
object to add. A device with a `dac~` and no `plugout~` is told that `dac~` is silent
inside Live. The file is only judged when it can be seen whole: an abstraction, a
`bpatcher` kept in another file or a `poly~` may hold the missing object.

Of the 82 devices that ship with Max, 18 can be seen whole (the rest are frozen, with
their abstractions beside the patcher), and none of them is flagged.

**Tests.** `test_m4l_06_an_instrument_needs_midi_in`,
`test_m4l_06_an_audio_effect_needs_audio_in`, `test_a_device_lacking_what_its_type_needs`.

## M4L-07: a parameter's range is invisible to the checks

**Closed for the inlets whose range Max documents.** The checks type a cord by rate (audio or not). They know nothing about the
values on it. In a device nearly every control cord starts at a dial with a declared
range and ends at an inlet with an expected one.

**Evidence.** A dial declared as 40 to 18000 (Hz) wired into `svf~`'s resonance inlet,
which takes 0 to 1, saves with no warning. The generator avoids this only because one
table (`schema.json`) is the single source of each dial's range.

It then happened for real. The first version of the generator shipped four dials whose
range ran past what the object behind them accepts, and nothing said so:

| Dial | Declared | What the object takes |
|---|---|---|
| Filter Cutoff into `svf~` | up to 18000 Hz | up to a quarter of the sample rate (11025 Hz) |
| Distortion Tone into `onepole~` | up to 18000 Hz | the same |
| Reverb Damp into `onepole~` | up to 16000 Hz | the same |
| Distortion Drive into `overdrive~` | up to 12 | 1 to 10 |

In Live the top third of each of those dials would have turned and changed nothing. They
were found by reading Max's reference pages, which state each limit in prose. The limits
are in the scraped reference data already, as text; this gap is about turning them into
something a check can read. A fifth case was a matter of degree, not of limits: `svf~`'s
resonance is nominally 0 to 1, and measured in Max it is flat below 0.17 and rings for
seconds above 0.85, so the dial now maps onto 0.17 to 0.75.

**Fix.** A first step that does not need full interval typing, in
`maxpylang/devicecheck.py`. The dial's range is read from its parameter block. It is
followed through the objects that have a plain rule for it (`*`, `/`, `+`, `-`, `!-`,
`!/`, `scale`, `zmap`, `clip`, `abs`, `mtof`, `dbtoa`, number boxes, `trigger`) and
compared with the inlet's documented range. A range that reaches past it raises a
`DeviceWarning` naming the parameter, both ranges and the inlet. Anything else on the way,
or a cord into an operator's right inlet, and the range is not known: no report.

The inlet ranges are in `maxpylang/data/value_ranges.json`, each with the sentence of
Max's reference page it was read from: `svf~` (cutoff, resonance), `onepole~` (cutoff),
`lores~` (resonance), `overdrive~` (drive), `triangle~` (peak position). That covers the
four dials above. A cutoff limit of a quarter of the sample rate is taken at 44.1 kHz.

**Still open.** The table is five objects. The other limits are in the scraped reference
data as prose, and reading them out wholesale is its own piece of work. Ranges are not
followed through `expr`, `line`, or a subpatcher.

**Tests.** `test_m4l_07_a_dial_range_is_checked_against_its_inlet`,
`test_a_range_that_fits_after_what_is_on_the_way`, `test_a_range_that_does_not_fit`.

## M4L-08: duplicate parameter names are accepted

**Closed.** Live identifies a parameter by its long name. Two parameters with the same
long name collide: automation and mappings attach to the wrong one, and Max renames one of
them on load. Two dials both named "Gain" saved with no warning.

**Fix.** At save, long names are compared across the whole file, subpatchers included, and
a name used twice raises a `DeviceWarning` listing the boxes. It holds for a plain patch
too. Parameters left unnamed are not compared: Max numbers those itself.

**Test.** `test_m4l_08_parameter_names_are_unique`.

## M4L-09: output level is unbounded

**Closed.** `CLAUDE.md` states a rule for every device: `clip~ -1. 1.` before `plugout~`,
for speaker safety. Nothing enforced it: `plugin~ -> *~ 4. -> plugout~` saved with no
warning.

**Fix.** The level reaching each `plugout~` is followed back through the signal cords as a
multiple of full scale. `plugin~` and the oscillators are 1. `*~ 0.5` halves it, `*~ 4.`
quadruples it, and a dial into `*~` counts by the dial's range, which is M4L-01 at work
again. Two cords into one inlet add. `clip~`, `tanh~`, `overdrive~` and `limi~` bring it
back to 1. A filter, a feedback loop, or any object with no rule may raise the level, so
it counts as unlimited. Above 1, `save()` raises a `DeviceWarning` naming the object
responsible. A device that only passes audio through or attenuates it is not warned, and
a path through a subpatcher, an abstraction or a `line~` ramp is not judged.

This one is advice, and it does fire on working devices: 6 of the 82 that ship with Max
end in a filter, a compressor or a `gain~` with nothing after it.

**Tests.** `test_m4l_09_output_level_is_bounded`, `test_a_level_that_stays_inside_full_scale`,
`test_a_level_that_can_pass_full_scale`, `test_a_gain_dial_counts_by_its_range`.

## M4L-10: a parameter that controls nothing is accepted

**Closed.** A `live.dial` with no cords is a knob in Live that does nothing. The graph
check reports other objects whose output reaches nothing, and did not report a
disconnected dial, because a UI object counts as a display.

**Fix.** In a device, a parameter with no cords at all raises a `DeviceWarning`. One that
is only fed is left alone: a `live.numbox` showing a value is a display. So is every
parameter in a device that holds something able to reach it by name (the `pattr` family,
`js`, `thispatcher`, `live.banks`). None of the devices that ship with Max is flagged.

**Test.** `test_m4l_10_a_parameter_controls_something`.

## M4L-11: audio objects whose inlets have no type

**Closed.** `cycle~ -> tanh~` was reported as a cord the checks could not judge ("no type
data"), on an object that takes a signal and nothing else. The cause is upstream: the
reference pages Max ships for about seventy inlets have a placeholder where the inlet
type goes (`<inlet id="0" type="INLET_TYPE">`), so the type table recorded them as `any`.
It showed up as soon as the generator used `tanh~`: the page's "Type check" panel went
from "all cords checked" to "2 not checked".

**Fix.** Where the type is a placeholder, the table now reads the rest of the page
(`_inlet_rate` in `maxpylang/tools/typedstubs.py`). An inlet whose own description says
it takes audio does ("Trigger Reset (signal)", "Right Audio Input"). An MSP object that
documents a `signal` method takes audio at its first inlet, since an MSP object's signal
inlets are its leftmost ones. That types `tanh~`, `cosh~`, `sinh~`, `tanx~`, `sinx~`,
`cosx~`, `sig~`, `click~`, `receive~`, `phasor~`'s second inlet and about fifty more.
The rule can only turn "not checked" into "takes audio", so it cannot cause a false
alarm. Inlets with no sign either way stay open (`number~`'s ramp time, `limi~`).

**Tests.** `test_m4l_11_tanh_is_judged`, `test_m4l_11_a_cord_into_cosh_is_judged`.

---

## A gap the checks caught

Worth recording because it is the loop working in the other direction. While the filter
was being reworked, a control object in the generated script was given the same variable
name as the Reso dial. Every cord written against the dial landed on the new object
instead, so the dial fed nothing and the object fed itself. The graph check reported it
on the next build ("hot loop through scale: every cord lands on a hot inlet"), and seven
presets failed their test. The generator now refuses a name used twice.

---

## Outside the type system

Found on the same pass. These are about the browser engine in `web/`, not about
maxpylang's types, and are listed so they are not lost.

- **The web object manifest is behind the library.** `web/scripts/gen-manifest.mjs`
  no longer runs against the current `OBJ_INFO`: it refuses the `p` alias, which the
  library now has, and it does not walk the `m4l` package at all. Regenerating with both
  fixed changes the arity rule count from 46 to 87 and breaks 21 web tests, so it is its
  own piece of work. Until then the `live.*` objects the page needs are registered by
  hand (`objects/ui/live-dial.ts`, `objects/audio/plug.ts`).
- **A signal into an inlet adds to the argument instead of replacing it.** In Max a
  signal connected to `*~ 0.5`'s right inlet replaces the 0.5. In the engine the signal
  is connected to an `AudioParam`, which sums with the value it already holds. The
  generator avoids the difference by giving an object no argument (or 0) wherever a
  signal drives that inlet.
- **A feedback loop runs 128 samples late in the browser.** Chrome adds one render
  quantum to every cycle in the audio graph, so each repeat of a `tapin~` / `tapout~`
  echo arrived 2.9 ms after it does in Max, and a reverb built on looped delays came out
  detuned. `tapout~` now has an early read for the cords that close a loop, and `comb~`
  is a worklet with its loop inside.
- **The preview is checked against Max, not assumed.** The generator's
  `scripts/maxcheck/` renders one test signal through the same generated patches in Max and in the engine and
  compares the recordings. The filter, every distortion type, the crusher, the delay, the
  flanger and the reverb now match a Max 9 recording to its last bit. What still differs
  (where an LFO starts, and a one-vector offset inside Max) is listed in that folder's
  README, along with the formulas the measurements gave for `svf~`, `overdrive~`,
  `onepole~`, `degrade~`, `comb~` and `allpass~`.
