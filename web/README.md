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

## Supported objects (this prototype)

`cycle~`, `phasor~`*, `*~`, `+~`, `-~`, `gain~`, `clip~`, `lores~`, `ezdac~`
(*`phasor~` is an approximation; see inline notes.)

## Verified

`hello_world` (`cycle~ 440 → *~ 0.2 → ezdac~`) self-tests to **440.0 Hz, RMS 0.1414**
(= 0.2 amplitude sine), confirming correct end-to-end audio rendering.

## Roadmap

- **M3** — full synth spine fidelity (AudioWorklet `phasor~`, faithful signal math).
- **M4** — control domain: scheduler + `metro`/`counter`/`random`/UI widgets.
- **M5** — meters, then MIDI (Web MIDI) and Jitter (`jit.*` → canvas/WebGL).
- **Switch to in-browser generation** — replace the file loader with Pyodide running
  maxpylang; the engine consumes the identical JSON, so nothing downstream changes.
