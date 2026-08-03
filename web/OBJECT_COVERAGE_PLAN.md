# Web Engine — Full Object Coverage Plan

Goal: support **as many of Max/MSP/Jitter's objects as possible in the browser**,
all compiled to JavaScript, with a rigorous unit + integration test suite — ideally
every object, or close to it. This document is the spec for an overnight autonomous run.

---

## 0. The target universe (measured, not guessed)

maxpylang already ships a **complete object-metadata database** at
`maxpylang/data/OBJ_INFO/*/*.json` — one file per object with its `maxclass`,
`numinlets`, `numoutlets`, `outlettype[]` (→ our signal/control/video domain), and
full argument signature. This is our source of truth and our fixture generator.

**1004 objects total:**

| Package | Count | Notes |
|--------|------:|-------|
| max    | 353 | control/message domain (317 control, 35 ui/sink, 1 video) |
| msp    | 443 | 179 signal + 231 control (meters/analysis) + 33 ui/sink |
| jit    | 208 | 136 video, 65 control, 5 ui, 2 signal |

**By implementation family (the real work breakdown):**

| Family | Count | Distinct effort |
|--------|------:|-----------------|
| `mc.*` multichannel signal | 207 | **Low** — thin wrappers over the mono `~` impl |
| signal `~` (non-mc) | 234 | Mixed — ~90 map to Web Audio nodes, rest need AudioWorklet or stub |
| control/other (max+msp msg) | 313 | **Mostly tractable** — pure JS logic |
| `jit.*` video/GPU | 208 | **Hard** — mostly honest stubs; small Canvas/WebGL subset real |
| `zl.*` list ops | 31 | **Low** — one shared list-op framework covers all 31 |
| data/storage (coll, dict, table, value, pattr…) | 11 | Medium — need a storage layer |

Aliases: `maxpylang/data/OBJ_INFO/obj_aliases.json` (51 entries: `t`→`trigger`,
`sel`→`select`, `<`→`lessthan`, …). Register the canonical impl once, alias the rest.

**Key reframe:** the denominator is not "all of Max" — it is *"every object a
maxpylang-generated patch can contain."* That is exactly the 1004 above, and it is a
closed, enumerable set. "100% coverage" is therefore a well-defined, reachable target
for *recognition*; *faithful behavior* is a tiered goal (below).

---

## 1. Coverage tiers (status is test-derived, never self-declared)

- **Tier A — Recognized (target: 1004/1004 = 100%).** Auto-generated from metadata:
  correct inlet/outlet counts, correct domain per outlet, renders in the graph, and
  **never throws on build**. Unimplemented behavior = safe pass-through/no-op.
- **Tier B — Functionally implemented (target: ~550–650).** Real behavior + passing
  unit tests. An object is only marked Tier B *if its tests are green* — the coverage
  report is generated from test results, so we can never overstate coverage.
- **Tier C — Deferred-hard (documented + stubbed).** FFT (`fft~`/`pfft~`), `gen~`,
  physical models, most GPU `jit.*`, heavy infra (`js`, `jsui`, `poly~`, `bpatcher`).
  Each gets a one-line reason in the coverage report. **No silent omissions.**

Realistic overnight outcome: **1004 recognized, ~550–650 functionally green, the rest
honestly stubbed with reasons.**

---

## 2. Architecture changes (build these first — they gate everything)

### 2.1 Metadata → manifest (`web/scripts/gen-manifest.mjs`)
Python-free Node script reads `../maxpylang/data/OBJ_INFO/**` and emits
`web/src/generated/manifest.json`:
```
{ "cycle~": { pkg:"msp", maxclass:"newobj", numInlets:2, numOutlets:1,
              outletDomains:["signal"], args:[{name,type,optional}], aliases:[] }, … }
```
Committed to the repo so tests and the runtime read it without touching Python.

### 2.2 Registry auto-population
On startup, register a **generated stub** for every manifest entry: correct
`signalIns`/`signalOuts`/`controlIns` array *lengths* and outlet domains, behavior =
no-op (control) / silent pass-through (signal, inlet0→outlet0 when both signal).
Hand-written factories in `objects/**` override stubs by name. Result: the graph shows
**zero "unsupported" objects**; the coverage line instead reports Tier A/B/C.

### 2.3 Alias layer
`register()` gains `registerAlias(alias, canonical)`; the manifest carries aliases so
`t`/`trigger` resolve to one impl.

### 2.4 Control-runtime upgrades (needed before most control objects)
- **List/atom value type.** Upgrade `ControlValue` from scalar to
  `Atom | Atom[]` (Max messages are lists). Unlocks `pack`/`unpack`/`zl.*`/`route`.
- **Shared transport clock.** A single scheduler (lookahead timer) drives `metro`,
  `tempo`, `clocker`, `line`, `pipe`, `delay`, `qmetro` — and is the same clock the
  audio transport starts/stops, so control and audio stay in sync.
- **Named buses & storage.** `send`/`receive` (`s`/`r`), `value`/`v`, `pv`, and a
  storage layer for `coll`/`table`/`dict`/`funbuff` (in-memory Map; import from patch
  args/embedded data where present).
- **`expr`/`if` mini-parser.** A tiny expression evaluator (shunting-yard) shared by
  `expr`, `if`, `vexpr`. High value, self-contained, heavily unit-tested.

### 2.5 Audio-runtime upgrades
- **AudioWorklet harness.** A generic worklet host so custom-DSP objects (`saw~`
  band-limited, `svf~`, `degrade~`, sample-accurate `phasor~`) can ship real math.
- **Buffer registry.** `buffer~`/`play~`/`groove~`/`record~`/`wave~` share a named
  `AudioBuffer` map (`AudioBufferSourceNode`), fed by `import`/drag-drop later.
- **`mc.*` wrapper.** A `multichannel(monoFactory, n)` helper builds N mono instances
  and fans I/O — turns 207 objects into thin declarations.

### 2.6 Directory layout
```
web/src/
  generated/manifest.json         # committed, from metadata
  generated/stubs.ts              # auto-registers Tier-A stubs
  objects/audio/{osc,filter,delay,dynamics,routing,env,sampler,analysis}.ts
  objects/control/{math,logic,list,timing,midi,data,route,convert}.ts
  objects/ui/*.ts
  objects/video/*.ts
  runtime/{scheduler,atoms,buses,storage,expr,worklet}.ts
```

---

## 3. Work breakdown (batches the overnight run executes)

Each batch = a self-contained module + its unit tests. Ordered by value/tractability.

### Wave 1 — Infrastructure (must land first; human-review before Wave 2)
Manifest gen, stub auto-registration, alias layer, atom/list value type, scheduler,
buses, expr parser, worklet harness, test scaffolding (§4). **~1 day of the run.**

### Wave 2 — Control (highest ROI: ~313 + 31 zl, mostly pure JS)
| Batch | Examples | Approach | Test |
|------|----------|----------|------|
| math | `+ - * / % pow sqrt abs min max round`, `expr`, `!/` | pure fn | golden + property |
| compare/logic | `> < == != >= <= && \|\| == !`, `if`, `sel/select`, `gate`, `switch`, `router`, `ggate` | pure | golden |
| bang/trigger | `trigger/t`, `bangbang/b`, `button`, `bng`, `onebang`, `delay`, `pipe`, `swap`, `buddy`, `uzi` | logic + clock | golden + fake-timer |
| list (`zl.*` ×31 + `pack/unpack/pak/thresh/iter/bag/funnel/spray/mean/bucket`) | one list framework | pure | golden + property (rev∘rev=id) |
| timing | `metro`, `tempo`, `clocker`, `qmetro`, `line`, `curve`, `speedlim`, `decode` | scheduler | fake-timer |
| convert | `mtof/ftom`, `atodb/dbtoa`, `itoa/atoi`, `tosymbol/fromsymbol`, `sprintf`, `scale`, `number/flonum/int/float` | pure | golden |
| random | `random`, `drunk`, `urn`, `decide`, `coin` | seeded RNG | statistical range |
| data/storage | `coll`, `table`, `value/v`, `dict`, `funbuff`, `bag`, `pattr` | storage layer | golden CRUD |
| midi-logic | `makenote`, `stripnote`, `notein/out`, `ctlin/out`, `midiparse/format`, `borax`, `flush`, `poly` (alloc) | pure logic; Web MIDI I/O optional | golden |
| routing/msg | `route`, `routepass`, `prepend`, `append`, `message`, `send/receive (s/r)`, `forward`, `grab` | buses | golden |

### Wave 3 — Audio (~234 signal, ~90 map cleanly; +207 mc.* nearly free)
| Batch | Examples | Web API | Test |
|------|----------|---------|------|
| oscillators | `cycle~ saw~ rect~ tri~ phasor~ noise~ pink~ train~ vs~` | Oscillator/Worklet | offline: dominant-freq |
| sig math | `*~ +~ -~ /~ !-~ !/~ sig~ clip~ scale~ pow~ abs~` | Gain/Constant/WaveShaper | offline: level/shape |
| filters | `lores~ biquad~ onepole~ svf~ reson~ cross~ hip~ lop~ bp~ notch~ teeth~` | Biquad/Worklet | offline: mag response |
| delay | `delay~ tapin~/tapout~ delread~/delwrite~ comb~` | DelayNode | offline: echo at t |
| dynamics | `limi~ omx.* compressor gate~ degrade~` | Compressor/WaveShaper | offline: gain curve |
| routing | `gain~ matrix~ selector~ send~/receive~ mc.* fanning` | Gain/Merger/Splitter | offline: routing |
| envelopes | `line~ curve~ adsr~ function trapezoid~` | AudioParam automation | offline: ramp shape |
| pan | `pan~ pan2~ pan4~` | StereoPanner | offline: L/R balance |
| sampler | `buffer~ play~ groove~ record~ wave~ 2d.wave~ index~ peek~ poke~` | AudioBufferSource | offline: playback |
| analysis | `meter~ avg~ peakamp~ snapshot~ number~ scope~` | Analyser | offline: readback |
| **Tier C audio** | `fft~ pfft~ ifft~ gen~ *.brass *.brass physical models` | — | stub + documented |

### Wave 4 — UI widgets (~73 sink/ui)
`toggle button slider dial kslider rslider umenu tab textbutton led matrixctrl
comment panel live.dial live.slider live.text live.numbox …` — real DOM widgets that
emit control values; rendered as HTML overlays on the SVG graph. Test: DOM interaction
(jsdom) → emitted value.

### Wave 5 — Jitter (~208) — mostly Tier C
Real subset: `jit.grab`→`getUserMedia`, `jit.window`/`jit.pwindow`→`<canvas>`,
`jit.matrix` passthrough, a few `jit.brcosa/jit.scalebias/jit.rota` as 2D-canvas/WebGL
shaders. Everything else: honest stub (correct I/O, no-op) with a reason. Test:
smoke/no-throw + the real subset gets a canvas-pixel assertion.

### Wave 6 — Report, docs, deploy
Generate `web/COVERAGE.md` (per-object tier, auto from test results), update README,
rebuild `docs/app`, deploy, verify live.

---

## 4. Test strategy (the core deliverable)

Five layers, fastest→slowest. Layers 1–4 run in Node (`vitest run`); layer 5 needs a
browser context (real `OfflineAudioContext`).

### 4.1 Signature tests — **all 1004, parametric, auto** (`test/signature.test.ts`)
For every manifest entry: build the node with default args and assert
`signalIns.length + controlIns coverage` and `signalOuts.length` match `numInlets`/
`numOutlets`, and each outlet's declared domain matches `outletDomains`. One loop →
1004 assertions. Catches wiring regressions across the whole set for free.

### 4.2 Build/fuzz test — **no object throws** (`test/fuzz.test.ts`)
(a) Instantiate every object with (i) no args, (ii) its metadata's default args,
(iii) garbage args — assert no throw. (b) **Mega-patch**: programmatically emit one
`.maxpat` containing all 1004 objects with representative cords, run the full
parser→engine build, assert it completes and reports Tier counts. This is the
"never crashes a patch" guarantee, enforced.

### 4.3 Control unit tests — **golden IO, table-driven** (`test/objects/*.test.ts`)
Per object: a `cases: [{inlets, expect: outlets}]` table fed through `controlIns`,
capturing `onControlOut`. Pattern already established in `test/control.test.ts`.
Every Tier-B control object needs ≥1 case; common ones need edge cases (empty list,
wrap, div-by-zero, negative). Timing objects use `vi.useFakeTimers()`.

### 4.4 Property tests — math & lists (`fast-check`)
Invariants instead of examples: `zl.rev∘zl.rev = id`, `pack`→`unpack` round-trips,
`+` matches JS `+`, `scale` is affine/monotone, `zl.sort` is ordered & a permutation.
Cheap, catches whole classes of bugs.

### 4.5 Audio tests — **offline render, acoustic assertions** (browser context)
Set up **Vitest browser mode (Playwright + Chromium headless)** so
`OfflineAudioContext` is the real implementation. Generalize `renderTone`:
- oscillator → assert `dominantHz`; filter → feed white noise, assert high-freq
  attenuation vs passband; delay → assert an impulse re-appears at delay time;
  gain/pan → assert level/balance; envelope → assert ramp slope; sampler → assert
  buffer plays. Each Tier-B audio object ships one such assertion.
- **Golden acoustic snapshots**: a suite of fixture patches with committed expected
  `{rms, dominantHz, …}`; drift fails CI. Extends today's self-test (hello_world →
  440 Hz / 0.1414).

### 4.6 Integration tests — **whole patches via maxpylang** (`test/integration/*.test.ts`)
maxpylang is the fixture generator (venv confirmed working — see §6). A Python script
emits `.maxpat` fixtures for representative multi-object chains, committed under
`web/public/test-patches/gen/`. Each fixture drives the **full** parser→engine
pipeline:
- **control chains** (arp, sequencer, logic routing): fake-timer, assert final values.
- **audio chains** (subtractive synth, FM, delay line, sampler): offline render,
  assert acoustic properties.
- **mixed** (metro→envelope→filter sweep): assert control modulates audio.
- **degradation**: patches containing Tier-C objects still build & the audio subset
  still sounds.

### 4.7 Coverage report — generated, committed, honest (`web/COVERAGE.md`)
A post-test script reads the test results + manifest and writes, per object, its Tier
(A recognized / B green / C stub+reason). This is the artifact that answers "what % is
supported" truthfully, and it's diffable per commit. **A drop in Tier-B count fails CI.**

### 4.8 CI
GitHub Action: `npm ci && npm test` (layers 1–4) on every push; browser-mode audio
layer (4.5) nightly or on-demand (Playwright download is heavy).

---

## 5. Overnight execution

### Vehicle A — Multi-agent Workflow (recommended for throughput)
Fan out by batch (§3). Each wave: parallel implementer agents (one per batch) write
the module + its unit tests; a verifier agent per batch runs `npm test -- <file>` and
adversarially checks a sample of cases; a synthesis step updates the manifest/report
and runs the full suite. Waves run in sequence (infra → control → audio → ui → jitter
→ report) so each builds on green foundations. Guardrails baked in:
- an object is marked Tier-B **only after its test file passes** (status is derived,
  not claimed);
- every batch commit runs the full suite first (no red commits);
- Tier-C objects must be *listed with a reason*, never silently skipped;
- per-batch commits so morning review sees granular, revertable progress.

*Requires your explicit go-ahead* (workflows fan out many agents / heavy token use).
Say **"use a workflow"** (or "ultracode") and I'll author + launch it.

### Vehicle B — Autonomous `/loop` (simple, unattended)
`/loop`: pick the next Tier-A-only object from the manifest → implement + test → run
suite → if green, commit and mark Tier-B → repeat until the batch is exhausted or a
budget is hit. Self-healing, single-threaded, easy to leave running. Lower throughput
than A but zero orchestration risk.

Either way the **infra wave (§2, Wave 1) should be reviewed by you before the bulk
run** — it defines the value type, scheduler, and test scaffold everything else builds on.

---

## 6. De-risking already done / to do

- ✅ **Object universe enumerated** (1004, categorized) from real metadata.
- ✅ **maxpylang fixture generation works** via a clean `python3.12 -m venv` +
  `pip install -e . numpy tabulate` (system `python3.14` has a broken `pyexpat`; the
  venv sidesteps it). The arp fixture was regenerated with authentic Max metadata.
- ⏳ **Vitest browser mode** (Playwright/Chromium) for real `OfflineAudioContext` — the
  main infra long-pole; set up in Wave 1 and smoke-tested before Wave 3.
- ⏳ **Manifest generator** — Node script over `OBJ_INFO/**` (no Python at runtime).

## 7. Honest limits (what "close to every object" will *not* mean overnight)

FFT-domain (`fft~`/`pfft~`/`gen~`), physical-model and granular MSP, and the GPU-bound
majority of `jit.*` will be **recognized and stubbed, not faithfully emulated** — real
implementations are multi-day each. Timing is JS-timer accurate (~1ms jitter), not
sample-accurate, except where moved into an AudioWorklet. These are documented per
object in `COVERAGE.md`, not hidden.

## 8. Definition of done

1. `manifest.json` covers 1004/1004; graph shows **no "unsupported" objects**.
2. Signature + fuzz tests green across all 1004 (nothing throws, all I/O correct).
3. ~550–650 objects Tier-B with passing unit tests; integration + acoustic suites green.
4. `COVERAGE.md` generated & committed (truthful per-object status).
5. `docs/app` rebuilt and deployed; live site verified.
