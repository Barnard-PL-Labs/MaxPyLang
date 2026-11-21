# MaxPyLang Web Engine (prototype)

A browser runtime that **plays maxpylang-generated `.maxpat` patches** via the Web Audio
API — no MaxMSP, no backend. This is the M0–M2 prototype: it loads a `.maxpat`, renders
the node graph, and produces sound for the supported (audio/MSP) subset.

## Run

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm test           # parser tests against real .maxpat files
```

Load a patch via the **sample dropdown**, the **file picker**, or by **dragging a
`.maxpat` onto the page**. Press **▶ Start audio** to hear it (browsers require a click
before audio can play). **✓ Self-test** renders the current patch offline and reports its
RMS + dominant frequency — an automatable "does it make sound?" check.

## How it works

```
.maxpat JSON ──▶ parser/maxpat.ts ──▶ IR (ir/types.ts) ──▶ engine/engine.ts
                                                              │
                    registry (engine/registry.ts)            ├─ signal cords → Web Audio .connect()
                    objects/audio/*  ──────────────▶          └─ control cords → handlers (scheduler: later)
```

- **Domain typing is read from the file.** Each outlet's `outlettype` (`"signal"` vs
  `""`/`"bang"` vs `"jit_matrix"`) tells the engine whether a cord is audio, control, or
  video — no inference.
- **Adding an object = one `register()` call** in `objects/audio/` (or future
  `control/`, `ui/`). Unsupported objects render as dashed placeholders and are listed in
  the coverage line; they never crash a patch.

## Object coverage

Every one of the **1004 Max/MSP/Jitter objects** in maxpylang's metadata database is
**recognized** — it builds with correct inlet/outlet arity + domain and never crashes a
patch. Objects come in two tiers:

- **Tier B (implemented):** real behavior with passing unit tests. **~311 objects
  (≈30%)** and rising — all of `objects/control/`, `objects/audio/`, `objects/ui/`, plus
  `mc.*` multichannel wrappers.
- **Tier A (stub):** correct I/O, no behavior yet — the DSP/GPU/infra tail.

**The authoritative, always-current list is [`COVERAGE.md`](./COVERAGE.md)**
(auto-generated from source by `npm run gen:coverage`, so it can never overstate).

How it fits together:

- `src/generated/manifest.json` (built by `npm run gen:manifest` from maxpylang's
  `data/OBJ_INFO/`) drives Tier-A stub registration and the signature tests.
- Real objects self-register; the bootstrap (`objects/index.ts`) auto-discovers every
  module via `import.meta.glob`, wires aliases (`t`→`trigger`, …), adds `mc.*` wrappers,
  then backfills stubs.
- The shared runtime contract lives in `src/runtime/`: `atoms` (the `Atom[]` message
  type), `scheduler` (transport-gated clock for `metro`/`delay`/…), `buses`
  (`send`/`receive`/`value`), `outlets` (the `makeOutlets` fan-out helper).

Two prototype simplifications: `metro` **auto-starts with the transport** so a patch
plays on ▶ without a toggle click (an explicit `0` still stops it); and control messages
are simple atom lists (no attributes).

## Verified

- `hello_world` (`cycle~ 440 → *~ 0.2 → ezdac~`) self-tests to **440.0 Hz, RMS
  0.1414** (= 0.2 amplitude sine) — correct end-to-end audio.
- `arpeggiator` (`metro → counter → + 60 → mtof → cycle~ → *~ → ezdac~`) drives an
  ascending chromatic scale from C4; the control chain is unit-tested
  (`test/control.test.ts`) down to the emitted frequencies.

## Testing

`npm test` runs the Node suite (~340 tests): **signature** tests assert every one of the
1004 objects satisfies its I/O contract; **fuzz** tests build every object with junk args
and a mega-patch of all objects without throwing; **golden** unit tests cover each
implemented object's behavior. A headless Web Audio mock (`test/setup/`) lets signal
objects instantiate without a browser. True acoustic assertions (does a filter actually
attenuate?) are the one deferred layer — they need Vitest browser mode (Playwright).

## Roadmap (remaining tiers — each needs specific infra)

- **AudioWorklet DSP** — `biquad~` (mutable coeffs), `+=~`, `rampsmooth~`, `degrade~`
  fidelity, physical models. Needs a worklet host **and** browser-mode acoustic tests.
- **Jitter video** — real `jit.grab`→`getUserMedia`, `jit.window`→canvas, plus video-cord
  wiring in the engine; the GPU matrix tail stays stubbed.
- **Web MIDI I/O** — the `*out`/`*in` sinks (`noteout`, `ctlout`, …) once Web MIDI lands.
- **Heavy infra** — `js`/`jsui`, `poly~`, `pattr`/`autopattr`, `bpatcher`.
- **In-browser generation** — swap the file loader for Pyodide running maxpylang; the
  engine consumes identical JSON, so nothing downstream changes.
