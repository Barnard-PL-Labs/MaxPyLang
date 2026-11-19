# Object reference

The front page of the MaxPyLang docs: Max objects grouped by category, each with a maxpylang
example you can play, edit and run in the browser, in the style of
[Hydra's reference](https://hydra.ojack.xyz/api/).

It reuses the audio engine and the Python compiler from [`../web`](../web) (MaxPyStudio)
without changing them, and installs no packages of its own: everything resolves from
`../web/node_modules`.

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
- **Envelopes for `line~` / `curve~` are one list** (`"1 10 0 400"`), not comma-separated
  messages: a comma sends two messages, and the second replaces the first.

## Tests

- `npm test` (Node): every listed object and every object an example uses plays in the browser.
- `npm run test:browser` (Chromium): each example is rendered offline, with the engine's clock
  stepped every 10 ms of audio. It must make sound, not clip, change over time if a `metro`,
  `delay` or `pipe` drives it, and play the expected pitch for the steady tones. (Offline,
  because a headless browser's real-time audio clock stalls.)

## Build

`npm run build` writes `../docs/index.html` and `../docs/reference-assets/`. The CI workflow
(`.github/workflows/docs.yml`) builds the Sphinx guides first and this last.
