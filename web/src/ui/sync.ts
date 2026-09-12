// Who owns the patch: the canvas, or the Python?
//
// The patcher has two editable views of one document, and they are NOT symmetric.
//
//   Python -> canvas is LOSSLESS. Running the script produces a .maxpat, the .maxpat
//   produces a document, and every box and cord the script described is there. Nothing
//   the canvas can hold is missing. So a Run (or a Load) just replaces the document, with
//   no warning and nothing to reconcile.
//
//   canvas -> Python is DESTRUCTIVE. Code generation is a projection (see
//   codegen/maxpy.ts): sixteen objects that came out of a `for` loop come back as
//   sixteen literal place() calls, and the loop, the comments and the author's own
//   variable names are gone. There is no transform — not even libcst under Pyodide —
//   that can express "you dragged the box the loop created" back into the loop.
//
// So exactly one direction is guarded, and the guard is a BANNER, never a dialog. The
// canvas edit that triggers it has ALREADY been applied by the time this controller
// hears about it, because a modal that interrupts a drag to ask a question about source
// code is a worse product than a patch that is briefly out of sync. The banner asks
// which of the two the user wants to keep, and until they answer, both of them work.
//
// The state machine, in full:
//
//                      ┌──────────── adopt() ◄───────────┐
//                      ▼                                 │
//   ┌────────────────────────────────┐   detach()   ┌─────────────────────────────┐
//   │ owner = 'canvas'               │─────────────►│ owner = 'python'            │
//   │ pane = read-only projection,   │              │ pane = the user's buffer,   │
//   │ regenerated on a 150ms debounce│◄─────────────│ never written to unasked    │
//   └────────────────────────────────┘   adopt()    └─────────────────────────────┘
//        ▲                                               │
//        │                                    onCanvasChanged() while 'python'
//        │                                               ▼
//        │                                   ┌──────────────────────────┐
//        └─────────── adopt() ───────────────│ CONFLICT banner          │
//                                            │ [Switch to generated…]   │
//                                            │ [Keep my Python] ────────┼──► forked:
//                                            └──────────────────────────┘    'code out
//                                                                            of sync —
//   onPythonRun(json) from anywhere: owner := 'python', fork cleared,          N canvas
//   document replaced wholesale (lossless, so no confirmation).                edits'
//
// In the forked ("keep my Python") state canvas edits still reach the document and the
// engine, so the user can go on auditioning while their script stands. The pane says how
// far apart the two have drifted and offers two ways out, each of which throws work
// away and so each of which carries a confirmation prompt the UI must put to the user:
// ▶ Run discards the canvas edits, ⟳ Regenerate discards the Python.
//
// Deliberately DOM-free. Everything here is a state machine over a document and two
// callbacks, which is what lets test/sync.test.ts drive every transition headlessly. The
// banner is described, not drawn — patcher/python-pane.ts renders whatever this emits.

import { patchToMaxPy, type MaxPyOptions, type MaxPySource } from '../codegen/maxpy';

/** Which view is the source of truth. The other one is a projection of it. */
export type Owner = 'canvas' | 'python';

export type BannerActionId = 'adopt' | 'keep' | 'detach' | 'regenerate' | 'run';

export interface BannerAction {
  id: BannerActionId;
  label: string;
  /** The recommended answer, for the UI to style as the default. */
  primary?: boolean;
  /**
   * Set when running this action throws away work that cannot be recovered.
   *
   * It is the exact question the UI must put to the user BEFORE calling run(); this
   * module never prompts, because a controller that called window.confirm() could not be
   * tested headlessly and could not be reused by a non-DOM caller. An action with no
   * `confirm` is safe to run on a single click.
   */
  confirm?: string;
  /** Perform the action. Safe to call twice; the controller is idempotent. */
  run(): void;
}

export interface BannerState {
  kind: 'conflict' | 'out-of-sync' | 'projection';
  tone: 'info' | 'warn';
  message: string;
  /** Canvas edits made since the two views forked. Zero unless kind is 'out-of-sync'. */
  pendingEdits: number;
  actions: BannerAction[];
}

/**
 * What this controller needs from the editor pane.
 *
 * Structural, so test/sync.test.ts can pass a plain object that records what it was
 * handed, and so nothing here has to import CodeMirror or touch a document object.
 * patcher/python-pane.ts's `PythonPane` satisfies it.
 */
export interface SyncPane {
  getSource(): string;
  setSource(text: string, opts?: { readOnly?: boolean }): void;
  /**
   * Compile and run the buffer. Optional only so a test double can leave it off; the
   * out-of-sync banner's ▶ Run action is inert without it.
   *
   * Nothing is awaited here: a successful run reaches this controller as onPythonRun(),
   * which is also the path a Run from the pane's own toolbar takes, so there is exactly
   * one place the state machine learns that the script produced a patch.
   */
  run?(): Promise<void>;
}

export interface SyncOptions {
  /**
   * The live document, or a getter for it.
   *
   * Pass the getter whenever the host can REPLACE the document (the patcher does, on
   * every open and every ▶ Run), or this controller will go on generating code from the
   * document that was current when it was constructed.
   */
  doc: MaxPySource | (() => MaxPySource | null);
  pane: SyncPane;
  /** Called with the banner to show, or null to take it down. Fires only on a change. */
  onBanner(state: BannerState | null): void;
  /**
   * Install compiled .maxpat JSON as the new document. Optional: without it,
   * onPythonRun() still moves the state machine and the host does the loading itself.
   */
  loadPatch?(json: unknown): void | Promise<void>;
  /** Debounce for the read-only projection, in ms. Default 150. */
  debounceMs?: number;
  /** Forwarded to patchToMaxPy — the save() filename, mostly. */
  codegen?: MaxPyOptions;
  /** Initial owner. Default 'canvas': the patcher opens on its canvas. */
  owner?: Owner;
}

const DEFAULT_DEBOUNCE_MS = 150;

const CONFLICT_MESSAGE =
  "Your Python can't represent canvas edits automatically.";

const PROJECTION_MESSAGE =
  'Generated from the canvas. Edits here are overwritten on the next canvas change.';

const CONFIRM_RUN =
  'Run the Python as it stands? The canvas edits you made since will be discarded.';

const CONFIRM_REGENERATE =
  'Replace the Python with code generated from the canvas? Your script will be lost.';

export class SyncController {
  private readonly opts: SyncOptions;
  private readonly debounceMs: number;

  private _owner: Owner;
  /** True once the user chose "Keep my Python" — canvas edits accrue but never land. */
  private forked = false;
  private edits = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private banner: BannerState | null = null;
  /**
   * Depth of an in-flight document replacement.
   *
   * loadPatch() swaps the document, and a host that forwards its document's change feed
   * to onCanvasChanged() will report that swap as a canvas edit — which would raise the
   * conflict banner on the very Run that was supposed to clear it. Counted rather than
   * boolean so overlapping loads can't clear it early.
   */
  private loading = 0;

  constructor(opts: SyncOptions) {
    this.opts = opts;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this._owner = opts.owner ?? 'canvas';
  }

  // ---------------------------------------------------------------------------
  // reading
  // ---------------------------------------------------------------------------

  get owner(): Owner {
    return this._owner;
  }

  /** True while the user is keeping a script the canvas has since moved past. */
  get isForked(): boolean {
    return this.forked;
  }

  /** Canvas edits made since the two views forked. */
  get pendingEdits(): number {
    return this.edits;
  }

  /** The banner currently up, or null. Same object last handed to onBanner. */
  get bannerState(): BannerState | null {
    return this.banner;
  }

  // ---------------------------------------------------------------------------
  // the four inputs
  // ---------------------------------------------------------------------------

  /**
   * One transaction landed on the document.
   *
   * Call it from `doc.on(...)`, once per transaction — not once per op. In 'canvas' mode
   * it schedules the projection; in 'python' mode it is the edit the guard exists for.
   */
  onCanvasChanged(): void {
    // A document swap we caused is not a canvas edit. See `loading`.
    if (this.loading > 0) return;

    if (this._owner === 'canvas') {
      this.schedule();
      return;
    }

    this.edits++;
    if (this.forked) {
      // Already chosen: just keep the count honest. The buffer is NOT touched — that is
      // the whole promise of "Keep my Python".
      this.show(this.outOfSyncBanner());
    } else {
      // First divergence. The edit has already been applied; this only asks which view
      // the user wants to keep.
      this.show(this.conflictBanner());
    }
  }

  /**
   * The user typed in the editor.
   *
   * Ownership follows the keyboard: whatever the pane was showing, it is now a buffer
   * somebody is writing, so the pending projection is cancelled rather than allowed to
   * land on top of a half-typed line.
   */
  onPythonEdited(): void {
    this.cancel();
    if (this._owner === 'canvas') {
      // They typed into what was a read-only projection (the host let them, or they
      // detached and this is the first keystroke). Treat it as a detach.
      this._owner = 'python';
      this.forked = false;
      this.edits = 0;
      this.show(null);
      return;
    }
    // Already theirs. A conflict or out-of-sync banner stays up: editing the script does
    // not make the canvas edits representable, so the drift is still real.
  }

  /**
   * The script ran and produced a patch. Python -> canvas is lossless, so this replaces
   * the document outright with nothing to confirm, and the two views are in sync again.
   */
  onPythonRun(json: unknown): void {
    this.cancel();
    this._owner = 'python';
    this.forked = false;
    this.edits = 0;
    this.show(null);
    void this.replaceDoc(json);
  }

  // ---------------------------------------------------------------------------
  // the four answers
  // ---------------------------------------------------------------------------

  /**
   * "Switch to generated code": the canvas becomes the source of truth and the pane
   * becomes a live, read-only projection of it.
   *
   * Safe — it discards nothing the user cannot get back by pressing Detach, since the
   * script it replaces was either generated or is still on the undo stack of whatever
   * editor they typed it into. Idempotent, and also the right call to seed the pane when
   * the drawer is first opened.
   */
  adopt(): void {
    this.cancel();
    this._owner = 'canvas';
    this.forked = false;
    this.edits = 0;
    this.project();
    this.show(this.projectionBanner());
  }

  /**
   * "Keep my Python": the script stands, canvas edits go on reaching the document and
   * the engine (so the patch is still audible), and the pane says how far apart they are.
   */
  keep(): void {
    this.cancel();
    this._owner = 'python';
    this.forked = true;
    if (this.edits === 0) this.edits = 1;
    this.show(this.outOfSyncBanner());
  }

  /**
   * "Detach & edit": hand the buffer back to the user, text unchanged.
   *
   * The pane is left showing exactly what it was showing — the code was generated from
   * the current canvas a moment ago, so at this instant the two views agree and there is
   * nothing to warn about. The next canvas edit raises the conflict banner again.
   */
  detach(): void {
    this.cancel();
    this._owner = 'python';
    this.forked = false;
    this.edits = 0;
    this.opts.pane.setSource(this.opts.pane.getSource(), { readOnly: false });
    this.show(null);
  }

  /**
   * "⟳ Regenerate": overwrite the buffer with code generated from the canvas, and leave
   * the user owning it.
   *
   * THIS THROWS THE USER'S SCRIPT AWAY. The confirmation is the caller's to obtain — the
   * `confirm` string on the banner action is the question to ask — because a controller
   * that prompted could not be tested or reused headlessly. Never call it on a timer.
   */
  regenerate(): void {
    this.cancel();
    this._owner = 'python';
    this.forked = false;
    this.edits = 0;
    this.opts.pane.setSource(this.generate(), { readOnly: false });
    this.show(null);
  }

  // ---------------------------------------------------------------------------
  // maintenance
  // ---------------------------------------------------------------------------

  /** Run a pending debounced projection now. Returns true if there was one. */
  flush(): boolean {
    if (this.timer === undefined) return false;
    this.cancel();
    this.project();
    return true;
  }

  /** Drop the pending projection. The controller is inert afterwards. */
  destroy(): void {
    this.cancel();
  }

  /** The code this controller would project right now. */
  generate(): string {
    const doc = this.doc();
    if (!doc) return '';
    return patchToMaxPy(doc, this.opts.codegen);
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  private doc(): MaxPySource | null {
    const d = this.opts.doc;
    return typeof d === 'function' ? d() : d;
  }

  private schedule(): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.project();
    }, this.debounceMs);
  }

  private cancel(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private project(): void {
    if (this._owner !== 'canvas') return; // ownership changed while the timer was out
    this.opts.pane.setSource(this.generate(), { readOnly: true });
  }

  private async replaceDoc(json: unknown): Promise<void> {
    if (!this.opts.loadPatch) return;
    this.loading++;
    try {
      await this.opts.loadPatch(json);
    } finally {
      this.loading--;
    }
  }

  /** Emit only on a real change, so a host can re-render unconditionally. */
  private show(state: BannerState | null): void {
    const same =
      (state === null && this.banner === null) ||
      (state !== null &&
        this.banner !== null &&
        state.kind === this.banner.kind &&
        state.pendingEdits === this.banner.pendingEdits);
    this.banner = state;
    if (!same) this.opts.onBanner(state);
  }

  private conflictBanner(): BannerState {
    return {
      kind: 'conflict',
      tone: 'warn',
      message: CONFLICT_MESSAGE,
      pendingEdits: 0,
      actions: [
        { id: 'adopt', label: 'Switch to generated code', primary: true, run: () => this.adopt() },
        { id: 'keep', label: 'Keep my Python', run: () => this.keep() },
      ],
    };
  }

  private outOfSyncBanner(): BannerState {
    const n = this.edits;
    return {
      kind: 'out-of-sync',
      tone: 'warn',
      message: `code out of sync — ${n} canvas edit${n === 1 ? '' : 's'}`,
      pendingEdits: n,
      actions: [
        {
          id: 'run',
          label: '▶ Run (discard canvas edits)',
          confirm: CONFIRM_RUN,
          run: () => {
            void this.opts.pane.run?.();
          },
        },
        {
          id: 'regenerate',
          label: '⟳ Regenerate (replace the Python)',
          confirm: CONFIRM_REGENERATE,
          run: () => this.regenerate(),
        },
      ],
    };
  }

  private projectionBanner(): BannerState {
    return {
      kind: 'projection',
      tone: 'info',
      message: PROJECTION_MESSAGE,
      pendingEdits: 0,
      actions: [{ id: 'detach', label: 'Detach & edit', run: () => this.detach() }],
    };
  }
}
