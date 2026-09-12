// The Python drawer: the Studio, living inside the patcher.
//
// This is the whole reason studio.html can stop existing. It is a CodeMirror 6 editor
// (the same extension set studio.ts uses, so the two surfaces behave identically) plus a
// client for the Pyodide worker that already exists at compiler/pyodide-worker.ts. The
// worker is NOT rewritten here and its protocol is not re-specified: this file only
// speaks it.
//
// THE ONE RULE THIS MODULE EXISTS TO KEEP: Pyodide is ~15 MB of WebAssembly plus numpy
// plus the maxpylang wheel, and most visitors open the patcher to look at a canvas and
// never touch Python. So the Worker is constructed on FIRST USE — a run(), or a
// preload() the shell calls when the drawer is first opened — and never at module load,
// never in the constructor, and never from a listener that fires on page boot. Nothing
// at module scope here touches `document`, `Worker`, or an import that reaches Pyodide;
// the only module-level statements are two string constants. If you add a top-level
// `import` of anything under compiler/, or move `ensurePython()` into the constructor,
// every visitor downloads a Python runtime to look at a graph.
//
// CodeMirror is lazy for a weaker but real version of the same reason (~400 KB the
// patcher page would otherwise ship to draw boxes), which is why every runtime import
// below is dynamic and this module's static imports are types only. The editor loads
// when the pane is constructed, so CONSTRUCT THE PANE WHEN THE DRAWER FIRST OPENS, not
// on page load. Calls that arrive before it has mounted are buffered, not dropped.
//
// The pane renders its own chrome inside the host element it is handed (patcher.html
// declares the drawer, not its contents) and owns nothing outside it.

import type { BannerState } from '../ui/sync';

/** Where the Pyodide runtime comes from. Same build studio.ts pins. */
const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v314.0.3/full/';

/** The maxpylang wheel, served from the app's own base path (docs/app/ under Pages). */
const WHEEL_PATH = 'py/maxpylang-0.1.1-py3-none-any.whl';

export type PaneStatusKind = 'info' | 'ok' | 'error';

export interface PythonPaneOptions {
  /**
   * A compile succeeded: `json` is the parsed .maxpat the script save()d. Called only on
   * success, so a caller never has to check for an error shape.
   */
  onRun(json: unknown): void;
  /**
   * Progress and failure, for the shell's status line. `kind` is additive — a handler
   * written as `(msg: string) => void` is still assignable.
   */
  onStatus(msg: string, kind?: PaneStatusKind): void;
  /**
   * The user typed. Fires only for edits the USER made: setSource() suppresses it, which
   * is what stops a regenerated projection from looking like a detach. Wire it to
   * SyncController.onPythonEdited().
   */
  onEdit?(): void;
  /** A banner action was clicked and (where it asks for one) confirmed. */
  onAction?(id: BannerState['actions'][number]['id']): void;
}

/** The CodeMirror pieces, once the dynamic import has landed. */
interface CodeMirrorBundle {
  EditorView: typeof import('codemirror')['EditorView'];
  basicSetup: typeof import('codemirror')['basicSetup'];
  keymap: typeof import('@codemirror/view')['keymap'];
  indentWithTab: typeof import('@codemirror/commands')['indentWithTab'];
  python: typeof import('@codemirror/lang-python')['python'];
  oneDark: typeof import('@codemirror/theme-one-dark')['oneDark'];
  maxpyComplete: typeof import('../compiler/completions')['maxpyComplete'];
}

type EditorViewInstance = InstanceType<CodeMirrorBundle['EditorView']>;

/**
 * CodeMirror's `Extension` type, derived from the EditorView constructor rather than
 * imported from @codemirror/state.
 *
 * That package is a transitive dependency of the four this app actually declares, and
 * importing it directly — even for a type — would put a name in package.json's blind
 * spot. Reading the type back off the constructor costs one line and keeps the declared
 * dependency set honest.
 */
type CmExtension = NonNullable<
  NonNullable<ConstructorParameters<CodeMirrorBundle['EditorView']>[0]>['extensions']
>;

export class PythonPane {
  private readonly opts: PythonPaneOptions;

  // ── chrome (built synchronously; cheap, and the drawer must not look empty) ────
  private readonly root: HTMLDivElement;
  private readonly runBtn: HTMLButtonElement;
  private readonly stateEl: HTMLSpanElement;
  private readonly noticeEl: HTMLDivElement;
  private readonly editorHost: HTMLDivElement;
  private readonly outputEl: HTMLPreElement;

  // ── editor (dynamic import; source is buffered until it lands) ────────────────
  private cm: CodeMirrorBundle | undefined;
  private view: EditorViewInstance | undefined;
  private buffer = '';
  private readOnly = false;
  /** True while setSource() is dispatching, so its own change doesn't look like typing. */
  private applying = false;

  // ── Pyodide worker (STRICTLY first-use; see the module header) ────────────────
  private worker: Worker | undefined;
  private pythonReady: Promise<void> | undefined;
  private resolveReady: (() => void) | undefined;
  private rejectReady: ((err: Error) => void) | undefined;
  private ready = false;
  private compileId = 0;
  private readonly pending = new Map<number, { ok(json: string): void; fail(msg: string): void }>();

  private destroyed = false;

  constructor(host: HTMLElement, opts: PythonPaneOptions) {
    this.opts = opts;

    this.root = div('py-pane');
    this.root.style.display = 'flex';
    this.root.style.flexDirection = 'column';
    this.root.style.minHeight = '0';
    this.root.style.height = '100%';

    const bar = div('py-bar');
    this.runBtn = document.createElement('button');
    this.runBtn.type = 'button';
    this.runBtn.className = 'py-run';
    this.runBtn.textContent = '▶ Run';
    this.runBtn.title = 'Compile this script with maxpylang and load the patch (⌘/Ctrl+Enter)';
    this.runBtn.addEventListener('click', () => void this.run());

    this.stateEl = document.createElement('span');
    this.stateEl.className = 'py-state';
    this.stateEl.textContent = 'Python not loaded';

    bar.append(this.runBtn, this.stateEl);

    this.noticeEl = div('py-notice');
    this.noticeEl.hidden = true;

    this.editorHost = div('py-editor');
    this.editorHost.style.flex = '1 1 auto';
    this.editorHost.style.minHeight = '0';
    this.editorHost.style.overflow = 'hidden';

    this.outputEl = document.createElement('pre');
    this.outputEl.className = 'py-output';
    this.outputEl.hidden = true;

    this.root.append(bar, this.noticeEl, this.editorHost, this.outputEl);
    host.append(this.root);

    // The editor, not the runtime. See the module header for why even this is deferred
    // and why the pane should be constructed on the drawer's first open.
    void this.ensureEditor();
  }

  // ---------------------------------------------------------------------------
  // public API
  // ---------------------------------------------------------------------------

  /** True once the Pyodide worker has reported `ready` — i.e. run() will not stall. */
  get isReady(): boolean {
    return this.ready;
  }

  /** The editor's text. Correct before the editor has mounted, too. */
  getSource(): string {
    return this.view ? this.view.state.doc.toString() : this.buffer;
  }

  /**
   * Replace the text, optionally flipping read-only.
   *
   * Does NOT fire onEdit — this is how the canvas projects itself into the pane, and a
   * projection that announced itself as a user edit would hand ownership straight back
   * to the Python on every canvas change.
   *
   * Read-only is applied by rebuilding the view rather than through a Compartment, which
   * would mean importing @codemirror/state — a package this app does not depend on
   * directly. The rebuild costs a DOM swap and happens only on adopt/detach, which are
   * deliberate mode switches; the debounced projection passes no `readOnly` at all and
   * so takes the cheap dispatch path.
   */
  setSource(text: string, opts: { readOnly?: boolean } = {}): void {
    const nextReadOnly = opts.readOnly ?? this.readOnly;
    this.buffer = text;

    if (!this.view) {
      this.readOnly = nextReadOnly;
      return;
    }
    if (nextReadOnly !== this.readOnly) {
      this.readOnly = nextReadOnly;
      this.remountEditor();
      return;
    }
    this.applying = true;
    try {
      this.view.dispatch({
        changes: { from: 0, to: this.view.state.doc.length, insert: text },
      });
    } finally {
      this.applying = false;
    }
  }

  /** Show (or clear, with null) the sync banner above the editor. */
  setNotice(state: BannerState | null): void {
    this.noticeEl.replaceChildren();
    if (!state) {
      this.noticeEl.hidden = true;
      return;
    }
    this.noticeEl.hidden = false;
    this.noticeEl.dataset.tone = state.tone;

    const message = document.createElement('span');
    message.className = 'py-notice-text';
    message.textContent = state.message;
    this.noticeEl.append(message);

    for (const action of state.actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = action.primary ? 'py-notice-btn primary' : 'py-notice-btn';
      button.textContent = action.label;
      button.addEventListener('click', () => {
        // The confirmation belongs here, in the DOM layer: ui/sync.ts describes which
        // actions destroy work and with what question, and never prompts itself.
        if (action.confirm && !confirm(action.confirm)) return;
        action.run();
        this.opts.onAction?.(action.id);
      });
      this.noticeEl.append(button);
    }
  }

  /**
   * Start downloading Pyodide.
   *
   * THE ONLY PLACE THE SHELL SHOULD CALL THIS IS WHEN THE DRAWER IS OPENED. Idempotent:
   * the second call returns the first call's promise.
   */
  preload(): Promise<void> {
    return this.ensurePython();
  }

  /**
   * Compile the buffer and hand the resulting patch to onRun.
   *
   * Never rejects. A Python traceback is a normal outcome of editing Python, not an
   * exception for the caller to handle, so it is surfaced verbatim (as studio.ts does)
   * and reported through onStatus. The returned promise resolves either way.
   */
  async run(): Promise<void> {
    if (this.destroyed) return;
    const source = this.getSource();
    this.runBtn.disabled = true;
    this.showOutput(null);
    try {
      await this.ensurePython();
      this.status('Running…');
      const json = await this.compile(source);
      this.opts.onRun(JSON.parse(json));
      this.status('Patch loaded from Python.', 'ok');
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      this.showOutput(message);
      this.status(message.split('\n').slice(-1)[0] || 'Python error', 'error');
    } finally {
      if (!this.destroyed) this.runBtn.disabled = false;
    }
  }

  /** Put the caret in the editor, once it exists. */
  focus(): void {
    this.view?.focus();
  }

  /** Tear down the worker, the editor and the chrome. Safe to call twice. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const { fail } of this.pending.values()) fail('the Python pane was closed');
    this.pending.clear();
    this.rejectReady?.(new Error('the Python pane was closed'));
    this.resolveReady = undefined;
    this.rejectReady = undefined;
    this.worker?.terminate();
    this.worker = undefined;
    this.pythonReady = undefined;
    this.ready = false;
    this.view?.destroy();
    this.view = undefined;
    this.root.remove();
  }

  // ---------------------------------------------------------------------------
  // editor
  // ---------------------------------------------------------------------------

  private async ensureEditor(): Promise<void> {
    if (this.cm || this.destroyed) return;
    const [cmMod, viewMod, commandsMod, pyMod, themeMod, completionsMod] = await Promise.all([
      import('codemirror'),
      import('@codemirror/view'),
      import('@codemirror/commands'),
      import('@codemirror/lang-python'),
      import('@codemirror/theme-one-dark'),
      import('../compiler/completions'),
    ]);
    if (this.destroyed) return;
    this.cm = {
      EditorView: cmMod.EditorView,
      basicSetup: cmMod.basicSetup,
      keymap: viewMod.keymap,
      indentWithTab: commandsMod.indentWithTab,
      python: pyMod.python,
      oneDark: themeMod.oneDark,
      maxpyComplete: completionsMod.maxpyComplete,
    };
    this.mountEditor();
  }

  private mountEditor(): void {
    const cm = this.cm;
    if (!cm || this.destroyed) return;
    const { EditorView, basicSetup, keymap, indentWithTab, python, oneDark, maxpyComplete } = cm;

    // One language instance per view, so its `data` facet (where the MaxPy completion
    // source is registered) belongs to this view alone — the same wiring as studio.ts.
    const pyLang = python();

    const extensions: CmExtension[] = [
      basicSetup,
      pyLang,
      oneDark,
      keymap.of([
        indentWithTab,
        {
          key: 'Mod-Enter',
          preventDefault: true,
          run: () => {
            void this.run();
            return true;
          },
        },
      ]),
      pyLang.language.data.of({ autocomplete: maxpyComplete }),
      // The drawer is a flex row of unknown height; without this the editor grows to fit
      // its content and the drawer scrolls instead of the code.
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { overflow: 'auto' },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !this.applying) this.opts.onEdit?.();
      }),
    ];
    if (this.readOnly) {
      // Non-editable rather than filtered: the caret and the "you can type here" cursor
      // both go away, which is the actual signal that this text is a projection.
      extensions.push(EditorView.editable.of(false));
    }

    this.view = new EditorView({
      doc: this.buffer,
      parent: this.editorHost,
      extensions,
    });
  }

  /** Rebuild the view in place — the read-only switch. See setSource. */
  private remountEditor(): void {
    const text = this.getSource();
    this.view?.destroy();
    this.view = undefined;
    this.buffer = text;
    this.mountEditor();
  }

  // ---------------------------------------------------------------------------
  // Pyodide worker — lazily constructed, never at module load
  // ---------------------------------------------------------------------------

  private ensurePython(): Promise<void> {
    if (this.pythonReady) return this.pythonReady;
    if (this.destroyed) return Promise.reject(new Error('the Python pane was closed'));

    this.pythonReady = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // A caller may legitimately fire-and-forget preload(); an init failure or a destroy()
    // must not then surface as an unhandled rejection. run() still sees the real error,
    // because it awaits the same promise and this handler doesn't consume it.
    this.pythonReady.catch(() => {});

    this.status('Python: starting…');
    this.stateEl.textContent = 'Python: loading…';

    // Vite rewrites this exact `new Worker(new URL(…, import.meta.url))` form at build
    // time into a hashed worker chunk; it must stay literal. Being inside a method is
    // what keeps the 15 MB download tied to a user gesture — see the module header.
    const worker = new Worker(new URL('../compiler/pyodide-worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker = worker;
    worker.onmessage = (e: MessageEvent) => this.onWorkerMessage(e.data);
    worker.onerror = (e: ErrorEvent) => {
      this.failReady(new Error(e.message || 'the Python worker failed to start'));
    };

    const wheelUrl = new URL(import.meta.env.BASE_URL + WHEEL_PATH, location.href).href;
    worker.postMessage({ type: 'init', pyodideCdn: PYODIDE_CDN, wheelUrl });

    return this.pythonReady;
  }

  private onWorkerMessage(m: {
    type: string;
    id?: number;
    json?: string;
    message?: string;
    phase?: string;
  }): void {
    if (this.destroyed) return;
    switch (m.type) {
      case 'status':
        this.stateEl.textContent = `Python: ${m.message}`;
        this.status(`Python: ${m.message}`);
        return;
      case 'ready':
        this.ready = true;
        this.stateEl.textContent = 'Python ready';
        this.status('Python ready — ⌘/Ctrl+Enter runs the script.', 'ok');
        this.resolveReady?.();
        this.resolveReady = undefined;
        this.rejectReady = undefined;
        return;
      case 'result':
        if (m.id !== undefined) this.pending.get(m.id)?.ok(m.json ?? '');
        return;
      case 'error':
        if (m.phase === 'init') {
          this.failReady(new Error(m.message ?? 'Python failed to start'));
        } else if (m.id !== undefined) {
          this.pending.get(m.id)?.fail(m.message ?? 'compile failed');
        }
        return;
      default:
        return;
    }
  }

  private failReady(err: Error): void {
    this.ready = false;
    this.stateEl.textContent = 'Python unavailable';
    // The promise is left REJECTED rather than cleared, so a second run() fails fast with
    // the same message instead of re-downloading a runtime that has already failed once.
    this.rejectReady?.(err);
    this.resolveReady = undefined;
    this.rejectReady = undefined;
    // Nothing can complete now; release every caller with the real reason.
    for (const { fail } of this.pending.values()) fail(err.message);
    this.pending.clear();
  }

  private compile(source: string): Promise<string> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('Python is not running'));
    const id = ++this.compileId;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { ok: resolve, fail: (msg) => reject(new Error(msg)) });
      worker.postMessage({ type: 'compile', id, source });
    }).finally(() => {
      this.pending.delete(id);
    });
  }

  // ---------------------------------------------------------------------------
  // chrome helpers
  // ---------------------------------------------------------------------------

  private status(message: string, kind: PaneStatusKind = 'info'): void {
    this.opts.onStatus(message, kind);
  }

  /** Python tracebacks, verbatim and unwrapped — the only useful form for a traceback. */
  private showOutput(text: string | null): void {
    this.outputEl.textContent = text ?? '';
    this.outputEl.hidden = text === null;
  }
}

function div(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}
