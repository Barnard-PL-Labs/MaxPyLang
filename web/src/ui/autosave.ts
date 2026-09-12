// The patch you did not save, still there after you closed the tab.
//
// Everything else in the patcher assumes the user will press ⌘S. Nobody presses ⌘S
// before the browser updates itself overnight. This module is the promise that the work
// survives anyway: a debounced copy of the current document in localStorage, written
// 1.5s after the last edit and flushed the instant the page is hidden.
//
// THREE things decide its shape, and all three are about staying out of the way:
//
//   • It never runs on a keystroke. `read()` serializes the whole document, which for a
//     big patch is real work, so the debounce is what makes this affordable at all: 200
//     edits during a drag cost exactly one write. That is also why `read` is a thunk —
//     the caller must NOT serialize eagerly and hand over the result.
//
//   • It never throws into the editor. localStorage is a synchronous API that throws
//     outright in a Safari private window, behind some enterprise policies, and — the
//     case that actually bites — whenever a patch carrying `buffer~` data crosses the
//     ~5MB origin quota. A patcher that started raising QuotaExceededError on every
//     single edit would be unusable, so the FIRST quota failure disables this install
//     for good and reports once through `onError`. Losing autosave is survivable;
//     losing the ability to type is not.
//
//   • It owns no clock, no document and no doc subscription that it did not create. The
//     trigger comes in through `opts.subscribe`, so this file has no opinion about what
//     "changed" means and no import from doc/. The integration is one call per document:
//
//         stopAutosave?.();
//         stopAutosave = installAutosave(() => patchToMaxPat(doc, { renumber: true }), {
//           subscribe: (changed) => doc.on(changed),
//           onError: (msg) => status(msg, 'error'),
//         });
//
// Deliberately NOT flushed on uninstall. Uninstall happens when the document is
// REPLACED — File ▸ Open, File ▸ New — and flushing there would write the patch the user
// just navigated away from, so a reload would restore the one they had closed. The
// pending timer is dropped instead, and the new document's first edit writes the slot.

/** The slice of localStorage this module uses. A stub in tests; `localStorage` in a page. */
export interface AutosaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AutosaveOptions {
  /** Storage key. Shares the `maxpy.patcher.` namespace with the layout preferences. */
  key?: string;
  /** Debounce window in ms. */
  delay?: number;
  /** Where to write. Defaults to `localStorage`, or nothing at all if there is none. */
  storage?: AutosaveStorage | null;
  /**
   * Register the change trigger. Called once at install; whatever it returns is called
   * at uninstall. Without it nothing is ever written — this module has no other way to
   * know an edit happened, and polling a document it cannot see would be a worse one.
   */
  subscribe?(changed: () => void): (() => void) | void;
  /** File name to remember alongside the patch, read at write time. */
  name?: () => string | undefined;
  /** One-shot user-facing report when autosave gives up. Never called twice per install. */
  onError?(message: string): void;
  /** Clock, for tests. */
  now?(): number;
}

/** What was in the slot. `savedAt` is what a "Restored your last patch" bar dates. */
export interface AutosaveSnapshot {
  json: unknown;
  savedAt: number;
  name?: string;
}

export const AUTOSAVE_KEY = 'maxpy.patcher.autosave';

const DEBOUNCE_MS = 1500;

/**
 * Slot format version. Bumped only if the record's SHAPE changes; loadAutosave() refuses
 * anything else, so an old tab's record can never be read as a new one.
 */
const SLOT_VERSION = 1;

interface Slot {
  v: number;
  savedAt: number;
  name?: string;
  json: unknown;
}

/**
 * Reaching `localStorage` at all can throw (a sandboxed iframe without
 * allow-same-origin, Safari's private mode in older versions), so even the lookup is
 * guarded, and it is done per call rather than once at import — a module-level read
 * would run before a test could install its stub.
 */
function defaultStorage(): AutosaveStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function resolveStorage(explicit?: AutosaveStorage | null): AutosaveStorage | null {
  return explicit === undefined ? defaultStorage() : explicit;
}

/**
 * Is this the quota, as opposed to any other failure?
 *
 * Three spellings because three engines: the standard name, Firefox's legacy name, and
 * the numeric codes older WebKit sets instead of a name. Getting this wrong in the
 * permissive direction would disable autosave over a transient error; getting it wrong
 * in the strict direction would leave it throwing on every edit, which is the failure
 * this module exists to avoid — so it errs permissive and any unexpected write failure
 * disables the install too (see below).
 */
function isQuotaError(err: unknown): boolean {
  const e = err as { name?: string; code?: number } | null;
  if (!e) return false;
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014
  );
}

/**
 * Start autosaving. Returns the uninstall thunk; calling it twice is harmless.
 *
 * @param read Produces the value to store — the .maxpat-shaped JSON for the document.
 *   Called at most once per debounce window, never on the change itself.
 */
export function installAutosave(read: () => unknown, opts: AutosaveOptions = {}): () => void {
  const key = opts.key ?? AUTOSAVE_KEY;
  const delay = opts.delay ?? DEBOUNCE_MS;
  const now = opts.now ?? Date.now;
  const storage = resolveStorage(opts.storage);

  let live = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reported = false;

  /** At most one report per install, whatever goes wrong and however often. */
  const giveUp = (message: string): void => {
    live = false;
    if (reported) return;
    reported = true;
    opts.onError?.(message);
  };

  if (!storage) {
    // No slot to write to. Report once and hand back a teardown that undoes nothing,
    // rather than installing listeners that could only ever fail.
    giveUp('Autosave is off: this browser is not allowing local storage.');
    return () => undefined;
  }

  const write = (): void => {
    if (!live) return;
    let payload: string;
    try {
      const slot: Slot = { v: SLOT_VERSION, savedAt: now(), name: opts.name?.(), json: read() };
      payload = JSON.stringify(slot);
    } catch (err) {
      // The document could not be serialized. That is a bug elsewhere, and retrying it
      // every 1.5s for the rest of the session would bury it in noise.
      giveUp(`Autosave is off: this patch could not be serialized (${(err as Error).message}).`);
      return;
    }
    try {
      storage.setItem(key, payload);
    } catch (err) {
      giveUp(
        isQuotaError(err)
          ? 'Autosave is off: this patch is too large for local storage. Save it as a .maxpat file.'
          : `Autosave is off: local storage refused the write (${(err as Error).message}).`
      );
    }
  };

  const flush = (): void => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    write();
  };

  const changed = (): void => {
    if (!live) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      write();
    }, delay);
  };

  // `pagehide` is the one that fires on a real navigation away in every browser
  // including Safari's back/forward cache; `visibilitychange` covers the case that
  // actually happens — switching tabs or apps and never coming back to this one. Both,
  // because neither alone is enough, and flush() is a no-op when nothing is pending.
  const onHide = (): void => flush();
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') flush();
  };
  const hasDom = typeof document !== 'undefined' && typeof addEventListener === 'function';
  if (hasDom) {
    addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
  }

  const unsubscribe = opts.subscribe?.(changed);

  let uninstalled = false;
  return () => {
    if (uninstalled) return;
    uninstalled = true;
    live = false;
    clearTimeout(timer);
    timer = undefined;
    if (hasDom) {
      removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    }
    if (typeof unsubscribe === 'function') unsubscribe();
  };
}

/**
 * Read the slot, or null if there is nothing usable in it.
 *
 * Null covers every "no" — empty, unreadable storage, not JSON, written by a future
 * version of this format. A restore prompt is only worth showing when there is really
 * something to restore, so a corrupt slot reads exactly like an absent one. It is left
 * in place rather than deleted: clearing storage is clearAutosave()'s job, and a module
 * that silently deleted the user's only copy on a bad parse would be the wrong kind of
 * tidy.
 */
export function loadAutosave(key: string = AUTOSAVE_KEY, storage?: AutosaveStorage | null): AutosaveSnapshot | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  let slot: Slot;
  try {
    slot = JSON.parse(raw) as Slot;
  } catch {
    return null;
  }
  if (!slot || slot.v !== SLOT_VERSION || slot.json == null) return null;
  const savedAt = typeof slot.savedAt === 'number' ? slot.savedAt : 0;
  return { json: slot.json, savedAt, ...(slot.name ? { name: slot.name } : {}) };
}

/** Drop the slot. For "Start fresh" on the restore bar, and after an explicit save. */
export function clearAutosave(key: string = AUTOSAVE_KEY, storage?: AutosaveStorage | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    /* nothing to do, and nothing worth interrupting the user over */
  }
}
