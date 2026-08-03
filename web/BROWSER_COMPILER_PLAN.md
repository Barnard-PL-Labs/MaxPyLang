# In-Browser MaxPy Compiler — Plan

Write **MaxPy (Python) in the browser → run it → generate `.maxpat` → play it**, all
client-side, static, no backend. This closes the loop with the existing web engine:
the missing middle of "prompt/type code → see the graph → hear it".

## 0. Why this is a small lift

The engine already consumes `.maxpat` JSON and maxpylang is pure Python that *produces*
`.maxpat` JSON. The "compiler" is just **running maxpylang in the browser** and handing
its output to the player that already exists. Only three genuinely new pieces:

1. run Python in the browser (Pyodide),
2. a code editor,
3. a run/error loop.

Everything downstream — parser → IR → engine → graph + audio, ~328 objects, tests —
is done.

```
┌─ code editor (CodeMirror) ─┐   Python source
│  write MaxPy               │ ─────────────►  ┌─ Pyodide (Web Worker) ─┐
└────────────────────────────┘                 │  maxpylang → get_json()│
                              .maxpat JSON ◄────┴────────────────────────┘
                                   │
                                   ▼   (ALREADY BUILT)
                     parser → IR → engine → graph + audio
```

## 1. Technology choices

- **Pyodide** (CPython→WASM, loadable from JS). Chosen because maxpylang is pure Python
  and its one heavy dep (numpy) ships prebuilt in Pyodide; `tabulate` etc. are
  pure-Python via `micropip`. MicroPython/RustPython rejected — incomplete stdlib/numpy.
- **Web Worker** hosts Pyodide. Python must never block the main thread's AudioContext/UI.
- **CodeMirror 6** for the editor (lighter than Monaco; Python mode; themeable). Monaco is
  the fallback if we want full IntelliSense later.
- **Static hosting unchanged** — Pyodide is WASM assets served from `docs/`; no backend,
  no accounts. Consistent with the project's original constraint.

## 2. The load-bearing unknown (de-risk FIRST)

Does `import maxpylang; MaxPatch()…get_json()` run under Pyodide? maxpylang's
`importobjs.py` uses `subprocess`/`glob`/file I/O to scan a *Max install* — that won't
work in WASM. But that is the object-**import** tooling; **building** a patch only needs
the bundled `OBJ_INFO` data. The spike answers: does the build path avoid those imports?

**maxpylang loading strategy** (decide after spike):
- (a) `micropip.install("maxpylang")` if the PyPI 0.1.1 wheel works under Pyodide, or
- (b) build a wheel from this repo and load it from a bundled URL, or
- (c) mount the package source into Pyodide's virtual FS.
Package data (`data/OBJ_INFO/**`) must be present — verify it ships in whichever path.

## 3. Milestones

- **S0 — Spike / de-risk (½ day).** Prove end-to-end in the *fastest* environment first:
  load Pyodide in **Node** (`pyodide` npm pkg), get maxpylang in, run the `hello_world`
  builder, capture JSON, feed it to the existing parser+engine (Node mock) and assert it
  builds with no unknowns. Then repeat in a real browser page → hear 440 Hz. **Gate:**
  a Python string in → a tone out. Everything after is UI on proven machinery.
- **S1 — Worker plumbing.** Pyodide in a Web Worker; message protocol
  (`{type:'compile', source}` → `{type:'result', json}` | `{type:'error', traceback}`).
  Lazy-load Pyodide only when the editor is opened. Loading/progress UI.
- **S2 — Editor page.** A `studio` view: CodeMirror pane | graph pane, a **Run** button,
  a console/error pane (Python tracebacks), and the existing transport (▶/■/self-test).
  Player stays a separate lightweight entry that doesn't pull Pyodide.
- **S3 — Live-coding.** Debounced re-run on edit; clean `engine.dispose()` teardown;
  preserve transport (keep playing across edits when possible). Type → hear it change.
- **S4 — Sharing + starters.** Encode source (or JSON) in a URL permalink
  (compressed/base64). Ship the demo patches as editable starter scripts.
- **S5 — Polish.** Error ergonomics, load states, mobile layout, docs, "open in the
  player" / "download .maxpat" (opens in real Max too).

## 4. Testing strategy

- **Node-Pyodide integration test (CI-able):** run a set of MaxPy scripts through
  Pyodide → JSON → parser → engine, assert no `unknown`/`stubbed` objects and cords
  wired — the same guarantee as `demo-patches.test.ts`, but from *source*. This makes
  the compiler path a first-class tested surface.
- **Worker protocol unit tests:** compile-request → result/error message shapes; bad
  Python yields a structured error, never a crash.
- **Editor smoke tests (Playwright):** type a script → Run → graph renders → ▶ makes
  sound (self-test hook). Reuse the existing browser-mode harness.
- **Determinism:** same source → same JSON (guards against nondeterministic layout).

## 5. Deployment

Static. Add Vite config for the worker + WASM assets; Pyodide either self-hosted under
`docs/` or from the official CDN (CDN avoids repo bloat but adds an external origin —
weigh against the "self-contained" ethos). The **studio** is a separate route so the
plain player never downloads Pyodide.

## 6. Non-goals (for now)

- LLM prompt → MaxPy integration (the eventual product loop; not this pass).
- A JS DSL "lite" path (zero-Pyodide alternative) — possible later, not now.
- Full Max editor parity (this is a runnable-sketch tool, not Max).

## 7. Definition of done (for the first cut)

Open the studio, type/edit a MaxPy script, hit Run (or on-edit), see the signal-flow
graph, press ▶ and hear it — with Python errors surfaced cleanly and a shareable URL —
all static, no backend. Merges to `main` behind its own route; the existing player is
untouched.
