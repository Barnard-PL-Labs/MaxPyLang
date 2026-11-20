# Object reference

The front page of the MaxPyLang docs: Max objects grouped by category, each with a maxpylang
example you can play, edit and run in the browser, in the style of
[Hydra's reference](https://hydra.ojack.xyz/api/).

It reuses the audio engine, the Python compiler and the patch canvas from [`../web`](../web)
(MaxPyStudio), and installs no packages of its own: everything resolves from
`../web/node_modules`. Its own code changes nothing in `web/`; where the engine behaved
differently from Max, the fixes are proposed to the engine's owner as their own PR.

## The visual patch

Each example shows the patch its code makes, as in
[maxpy-studio](https://github.com/Barnard-PL-Labs/maxpy-studio), drawn by MaxPyStudio's own
canvas (`web/src/ui/patcher.ts`, used read-only), so it looks the way it will after
↗ "open in MaxPyStudio". Drag to pan or move boxes, ⌘/Ctrl + scroll to zoom, and ⤢ to open the
patch large beside its code. While an example plays, its UI objects are the engine's live
widgets.

The examples don't call `set_position()`, so maxpylang saves each patch as one long row.
`layoutForReading()` (`src/patchview.ts`) arranges a copy top to bottom by signal flow for the
view and for the MaxPyStudio link; the code itself is unchanged.

## Run it

```bash
npm ci --prefix ../web                  # once
ln -s ../web/node_modules node_modules  # once
python scripts/build_examples.py        # after changing an example or maxpylang
npm run dev                             # http://localhost:5173
```

`build_examples.py` needs a Python with this repo's `maxpylang` installed
(`pip install -e ..`).

## Add an example

1. Write `content/examples/<stub>/<n>.py`, where `<stub>` is the object's Python name in
   `maxpylang.objects` (`cycle_tilde` for `cycle~`, `times_tilde` for `*~`) and `<n>` is 0, 1, 2…
2. The docstring's first line is the title, and the rest is a sentence shown under it. Copy an
   existing example for the shape: stubs and tuple `connect()`, `*~ 0.2` before `ezdac~`, and
   `patch.save()`.
3. If the object isn't listed yet, add it to its category in `content/categories.json`.
4. Run `python scripts/build_examples.py`, `npm test` and `npm run test:browser`.

Rules the build and tests check:

- **Use `ezdac~`, never `dac~`**: `dac~` makes no sound in the browser player.
- **Only objects that play in the browser** (tier B in `../web/src/engine/catalog.ts`).
- **A signal into an inlet that also has an argument: make the argument 0**, for example
  `cycle_tilde(0)` driven by a signal, or `"*~ 0."` times an envelope. Max ignores the argument
  once a signal is connected; the browser player adds the two, so `cycle~` (440 Hz by default)
  driven by 330 Hz would play 770 Hz. `test/browser/examples.test.ts` checks the pitch of the
  steady tones for this reason.
- **Envelopes for `line~` / `curve~` are one list** (`"1 10 0 400"`): `line~` runs every
  target-time pair in a message in turn, as in Max. (A comma in a message box sends separate
  messages, as in Max; for an envelope that would restart it at each part.)
- **The text must say what the example really does, in Max.** Check pitches, timing and
  outlets against Max's reference page (`/Applications/Max.app/.../*.maxref.xml`), not only
  against the browser.

## Tests

- `npm test` (Node): every listed object and every object an example uses plays in the browser,
  and each example's patch lays out top to bottom with no overlapping boxes.
- `npm run test:browser` (Chromium): each example is rendered offline, with the engine's clock
  stepped every 10 ms of audio. It must make sound, not clip, change over time if a `metro`,
  `delay` or `pipe` drives it, and play the expected pitch for the steady tones. (Offline,
  because a headless browser's real-time audio clock stalls.)
- `test/browser/claims-*.test.ts` (Chromium): what each example's text says it does, as
  checks: pitches, levels, timing, the values each box sends, outlet order, pixels for video.
  They use `test/browser/helpers/measure.ts`. A test marked `it.fails('BUG: …')` records a
  known mismatch with Max; when the bug is fixed it starts failing: turn it into `it`.

## Checking the examples in real Max

```bash
python scripts/export_for_max.py        # writes max-check/: every example as a .maxpat
```

`max-check/` then holds one `.maxpat` per example to open in Max, and `checklist.csv`: one
row per example with its claim, the known mismatches from the claim tests, and columns to
fill in after trying it in Max.

## Build

`npm run build` writes `../docs/index.html` and `../docs/reference-assets/`. The CI workflow
(`.github/workflows/docs.yml`) builds the Sphinx guides first and this last.
