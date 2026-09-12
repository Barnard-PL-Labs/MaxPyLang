// src/ui/sync.ts — who owns the patch, the canvas or the Python?
//
// The controller exists because the two directions are not symmetric: Python -> canvas
// is lossless and needs no guard, canvas -> Python is a projection that cannot express
// the loop that generated sixteen objects. So the whole of what is tested here is the
// asymmetry, and the promise that falls out of it:
//
//   NEVER SILENTLY REWRITE A BUFFER THE USER TYPED IN.
//
// The single most important case below is "a canvas edit in keep mode does not touch the
// pane buffer" — that is the promise, stated as an assertion. The rest of the state
// machine is here so a future change cannot reach that state by a path that skips it.
//
// The other half of the design is that the edit has ALREADY APPLIED by the time the
// controller hears about it. There is no "should I allow this" question anywhere in this
// file, and there must never be: blocking a drag on a dialog about source code is worse
// than being briefly out of sync.
//
// Headless (Node). The controller is deliberately DOM-free — it describes a banner and
// never draws one — so the pane is a plain object that records what it was handed, and
// the debounce is driven with fake timers rather than by waiting. Nothing here
// constructs a PythonPane: that needs a document, CodeMirror and (for run) a ~15 MB
// Pyodide download, none of which belong in `npx vitest run`. See codegen.test.ts.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PatchDoc } from '../src/doc/patch-doc';
import { loadBoxSpecs } from '../src/ir/objectspec';
import { SyncController, type BannerState, type SyncPane } from '../src/ui/sync';

const specsPresent = existsSync(
  fileURLToPath(new URL('../src/generated/boxspecs.json', import.meta.url)),
);
const itWithSpecs = it.skipIf(!specsPresent);

beforeAll(async () => {
  if (specsPresent) await loadBoxSpecs();
});

/** A pane that records everything, so an assertion can be about what it was NOT handed. */
class FakePane implements SyncPane {
  text = '';
  readOnly = false;
  /** Every setSource call, in order. Length is how many times the buffer was rewritten. */
  writes: { text: string; readOnly: boolean }[] = [];
  runs = 0;

  getSource(): string {
    return this.text;
  }

  setSource(text: string, opts: { readOnly?: boolean } = {}): void {
    this.text = text;
    if (opts.readOnly !== undefined) this.readOnly = opts.readOnly;
    this.writes.push({ text, readOnly: this.readOnly });
  }

  async run(): Promise<void> {
    this.runs++;
  }
}

interface Harness {
  doc: PatchDoc;
  pane: FakePane;
  sync: SyncController;
  banners: (BannerState | null)[];
  loaded: unknown[];
  /** The banner currently up, as the host last saw it. */
  banner(): BannerState | null;
  action(id: string): BannerState['actions'][number];
}

async function harness(opts: { owner?: 'canvas' | 'python' } = {}): Promise<Harness> {
  const doc = await PatchDoc.create();
  doc.addBox('cycle~ 440', 10, 10);
  doc.addBox('ezdac~', 10, 60);

  const pane = new FakePane();
  const banners: (BannerState | null)[] = [];
  const loaded: unknown[] = [];

  const sync = new SyncController({
    doc,
    pane,
    owner: opts.owner,
    onBanner: (state) => banners.push(state),
    loadPatch: (json) => {
      // What the real shell does: replace the document. A host that forwards its change
      // feed would report that as a canvas edit, so the controller has to suppress it.
      sync.onCanvasChanged();
      loaded.push(json);
    },
  });

  return {
    doc,
    pane,
    sync,
    banners,
    loaded,
    banner: () => (banners.length ? banners[banners.length - 1] : null),
    action: (id) => {
      const state = banners[banners.length - 1];
      const found = state?.actions.find((a) => a.id === id);
      if (!found) throw new Error(`no '${id}' action on the current banner`);
      return found;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('SyncController — owner = canvas (the pane is a projection)', () => {
  itWithSpecs('starts on the canvas, and adopt() seeds a read-only projection', async () => {
    const h = await harness();
    expect(h.sync.owner).toBe('canvas');

    h.sync.adopt();
    expect(h.pane.readOnly).toBe(true);
    expect(h.pane.text).toContain('patch.place("cycle~ 440")');
    expect(h.banner()?.kind).toBe('projection');
    expect(h.banner()?.actions.map((a) => a.id)).toEqual(['detach']);
  });

  itWithSpecs('a canvas edit regenerates, debounced', async () => {
    const h = await harness();
    h.sync.adopt();
    const seeded = h.pane.writes.length;

    h.doc.addBox('gain~', 10, 120);
    h.sync.onCanvasChanged();
    expect(h.pane.writes.length).toBe(seeded); // nothing yet: still inside the debounce

    vi.advanceTimersByTime(150);
    expect(h.pane.writes.length).toBe(seeded + 1);
    expect(h.pane.text).toContain('patch.place("gain~")');
    expect(h.pane.readOnly).toBe(true);
  });

  itWithSpecs('a burst of canvas edits regenerates once', async () => {
    const h = await harness();
    h.sync.adopt();
    const seeded = h.pane.writes.length;

    for (let i = 0; i < 20; i++) {
      h.doc.moveNodes(['obj-1'], 1, 0);
      h.sync.onCanvasChanged();
      vi.advanceTimersByTime(10);
    }
    expect(h.pane.writes.length).toBe(seeded);
    vi.advanceTimersByTime(150);
    expect(h.pane.writes.length).toBe(seeded + 1);
  });

  itWithSpecs('flush() lands a pending projection immediately', async () => {
    const h = await harness();
    h.sync.adopt();
    const seeded = h.pane.writes.length;
    h.sync.onCanvasChanged();
    expect(h.sync.flush()).toBe(true);
    expect(h.pane.writes.length).toBe(seeded + 1);
    expect(h.sync.flush()).toBe(false); // nothing pending any more
  });

  itWithSpecs('destroy() drops the pending projection', async () => {
    const h = await harness();
    h.sync.adopt();
    const seeded = h.pane.writes.length;
    h.sync.onCanvasChanged();
    h.sync.destroy();
    vi.advanceTimersByTime(1000);
    expect(h.pane.writes.length).toBe(seeded);
  });
});

describe('SyncController — detaching', () => {
  itWithSpecs('detach() hands the buffer back with its text unchanged', async () => {
    const h = await harness();
    h.sync.adopt();
    const projected = h.pane.text;

    h.action('detach').run();
    expect(h.sync.owner).toBe('python');
    expect(h.pane.readOnly).toBe(false);
    expect(h.pane.text).toBe(projected);
    expect(h.banner()).toBeNull();
  });

  itWithSpecs('detach cancels a projection that was already in flight', async () => {
    const h = await harness();
    h.sync.adopt();
    h.doc.addBox('gain~', 10, 120);
    h.sync.onCanvasChanged();
    h.sync.detach();
    const afterDetach = h.pane.writes.length;

    vi.advanceTimersByTime(1000);
    // The projection must not land on top of a buffer the user now owns.
    expect(h.pane.writes.length).toBe(afterDetach);
  });

  itWithSpecs('typing into the projection is itself a detach', async () => {
    const h = await harness();
    h.sync.adopt();
    h.sync.onPythonEdited();
    expect(h.sync.owner).toBe('python');
    expect(h.banner()).toBeNull();
  });
});

describe('SyncController — the conflict (first canvas edit while the Python is owner)', () => {
  itWithSpecs('raises a non-modal banner, and does not touch the buffer', async () => {
    const h = await harness({ owner: 'python' });
    h.pane.setSource('# my script\n', { readOnly: false });
    const mine = h.pane.text;
    const writes = h.pane.writes.length;

    h.doc.addBox('gain~', 10, 120);
    h.sync.onCanvasChanged();

    expect(h.banner()?.kind).toBe('conflict');
    expect(h.banner()?.message).toContain("can't represent canvas edits");
    expect(h.banner()?.actions.map((a) => a.id)).toEqual(['adopt', 'keep']);
    // The edit already applied to the document; the question is only which view survives.
    expect(h.doc.nodeCount).toBe(3);
    expect(h.pane.text).toBe(mine);
    expect(h.pane.writes.length).toBe(writes);
  });

  itWithSpecs('neither answer needs confirming — nothing is lost yet', async () => {
    const h = await harness({ owner: 'python' });
    h.sync.onCanvasChanged();
    expect(h.action('adopt').confirm).toBeUndefined();
    expect(h.action('keep').confirm).toBeUndefined();
  });

  itWithSpecs('[Switch to generated code] projects and takes the canvas', async () => {
    const h = await harness({ owner: 'python' });
    h.pane.setSource('# my script\n');
    h.sync.onCanvasChanged();
    h.action('adopt').run();

    expect(h.sync.owner).toBe('canvas');
    expect(h.sync.isForked).toBe(false);
    expect(h.sync.pendingEdits).toBe(0);
    expect(h.pane.readOnly).toBe(true);
    expect(h.pane.text).toContain('patch.place("cycle~ 440")');
    expect(h.banner()?.kind).toBe('projection');
  });

  itWithSpecs('[Keep my Python] counts the drift and says so', async () => {
    const h = await harness({ owner: 'python' });
    h.sync.onCanvasChanged();
    h.action('keep').run();

    expect(h.sync.owner).toBe('python');
    expect(h.sync.isForked).toBe(true);
    expect(h.banner()?.kind).toBe('out-of-sync');
    expect(h.banner()?.message).toBe('code out of sync — 1 canvas edit');
    expect(h.banner()?.pendingEdits).toBe(1);
  });
});

describe('SyncController — keep mode', () => {
  itWithSpecs('THE PROMISE: canvas edits never touch the buffer the user typed', async () => {
    const h = await harness({ owner: 'python' });
    const script = 'import maxpylang as mp\n# sixteen objects, in a loop\n';
    h.pane.setSource(script, { readOnly: false });
    const writes = h.pane.writes.length;

    h.sync.onCanvasChanged();
    h.action('keep').run();

    for (let i = 0; i < 5; i++) {
      h.doc.addBox('gain~', 10, 200 + i * 40);
      h.sync.onCanvasChanged();
      vi.advanceTimersByTime(500); // no debounce may fire in this mode, ever
    }

    expect(h.pane.text).toBe(script);
    expect(h.pane.writes.length).toBe(writes);
    expect(h.pane.readOnly).toBe(false);
    // …while the document and the engine went right on taking the edits, so the patch is
    // still audible. That is the point of the mode.
    expect(h.doc.nodeCount).toBe(7);
    expect(h.sync.pendingEdits).toBe(6);
    expect(h.banner()?.message).toBe('code out of sync — 6 canvas edits');
  });

  itWithSpecs('offers exactly two escapes, and both ask before destroying work', async () => {
    const h = await harness({ owner: 'python' });
    h.sync.onCanvasChanged();
    h.action('keep').run();

    expect(h.banner()?.actions.map((a) => a.id)).toEqual(['run', 'regenerate']);
    expect(h.action('run').confirm).toContain('discarded');
    expect(h.action('regenerate').confirm).toContain('lost');
  });

  itWithSpecs('▶ Run asks the pane to run — it does not reach into the document', async () => {
    const h = await harness({ owner: 'python' });
    h.sync.onCanvasChanged();
    h.action('keep').run();
    h.action('run').run();
    expect(h.pane.runs).toBe(1);
    // Still forked: the fork clears when the run SUCCEEDS, which arrives as onPythonRun.
    expect(h.sync.isForked).toBe(true);
  });

  itWithSpecs('⟳ Regenerate replaces the Python and leaves the user owning it', async () => {
    const h = await harness({ owner: 'python' });
    h.pane.setSource('# my script\n');
    h.sync.onCanvasChanged();
    h.action('keep').run();
    h.action('regenerate').run();

    expect(h.pane.text).toContain('patch.place("cycle~ 440")');
    expect(h.pane.readOnly).toBe(false);
    expect(h.sync.owner).toBe('python');
    expect(h.sync.isForked).toBe(false);
    expect(h.sync.pendingEdits).toBe(0);
    expect(h.banner()).toBeNull();
  });

  itWithSpecs('editing the Python does not make the drift go away', async () => {
    const h = await harness({ owner: 'python' });
    h.sync.onCanvasChanged();
    h.action('keep').run();
    h.sync.onPythonEdited();
    // The canvas edits are still unrepresentable; hiding the banner would be a lie.
    expect(h.banner()?.kind).toBe('out-of-sync');
    expect(h.sync.isForked).toBe(true);
  });
});

describe('SyncController — running the Python', () => {
  itWithSpecs('replaces the document wholesale, with no warning', async () => {
    const h = await harness({ owner: 'python' });
    h.sync.onCanvasChanged();
    h.action('keep').run();
    const before = h.banners.length;

    const json = { patcher: { boxes: [], lines: [] } };
    h.sync.onPythonRun(json);
    await vi.runAllTimersAsync();

    expect(h.loaded).toEqual([json]);
    expect(h.sync.owner).toBe('python');
    expect(h.sync.isForked).toBe(false);
    expect(h.sync.pendingEdits).toBe(0);
    expect(h.banners.length).toBeGreaterThan(before);
    expect(h.banner()).toBeNull();
  });

  itWithSpecs('the document swap it causes is not mistaken for a canvas edit', async () => {
    // loadPatch in the harness calls onCanvasChanged(), exactly as a host forwarding its
    // document's change feed would. Without the suppression that would raise the conflict
    // banner on the very run that was supposed to clear it.
    const h = await harness({ owner: 'python' });
    h.sync.onPythonRun({ patcher: { boxes: [], lines: [] } });
    await vi.runAllTimersAsync();
    expect(h.banner()).toBeNull();
    expect(h.sync.pendingEdits).toBe(0);
  });

  itWithSpecs('a run from canvas mode gives ownership back to the Python', async () => {
    const h = await harness();
    h.sync.adopt();
    h.sync.onPythonRun({ patcher: { boxes: [], lines: [] } });
    await vi.runAllTimersAsync();
    expect(h.sync.owner).toBe('python');
    expect(h.banner()).toBeNull();
  });
});

describe('SyncController — housekeeping', () => {
  itWithSpecs('the banner is emitted only when it actually changes', async () => {
    const h = await harness({ owner: 'python' });
    h.sync.onCanvasChanged();
    const afterFirst = h.banners.length;
    h.action('keep').run();
    const afterKeep = h.banners.length;

    // Two more edits: the count changes, so two more emissions and no more than two.
    h.sync.onCanvasChanged();
    h.sync.onCanvasChanged();
    expect(h.banners.length).toBe(afterKeep + 2);
    expect(afterFirst).toBe(1);
  });

  itWithSpecs('reads the document through a getter, so a swap is picked up', async () => {
    let doc = await PatchDoc.create();
    doc.addBox('cycle~ 1', 0, 0);
    const pane = new FakePane();
    const sync = new SyncController({
      doc: () => doc,
      pane,
      onBanner: () => {},
    });
    sync.adopt();
    expect(pane.text).toContain('cycle~ 1');

    doc = await PatchDoc.create();
    doc.addBox('saw~ 2', 0, 0);
    sync.adopt();
    expect(pane.text).toContain('saw~ 2');
    expect(pane.text).not.toContain('cycle~ 1');
  });

  itWithSpecs('generate() with no document yields an empty string, not a throw', async () => {
    const sync = new SyncController({ doc: () => null, pane: new FakePane(), onBanner: () => {} });
    expect(sync.generate()).toBe('');
  });
});
