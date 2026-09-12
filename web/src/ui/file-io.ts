// Getting a .maxpat in and out of the page — and the one thing the download-a-file
// approach can never do: save it back where it came from.
//
// The patcher's own save() drops a fresh copy in ~/Downloads every time, so editing one
// patch for an afternoon leaves `fm_synth (7).maxpat` next to six stale siblings and the
// user has to work out which one Max should open. That is the reason this module exists:
// with the File System Access API we keep the FileSystemFileHandle the picker gave us,
// and ⌘S writes through it — same file, no dialog, no duplicates. Everything else here
// is the fallback for the browsers that do not have it (Firefox and Safari today), which
// is a hidden <input type=file> on the way in and a Blob + <a download> on the way out.
// Both paths are real paths, not a preferred one plus an apology: the fallback is what
// Safari users get for as long as Safari lasts.
//
// TWO conventions worth knowing before calling anything here, because they are not
// symmetric and the asymmetry is deliberate:
//
//   • openMaxpat() returns NULL when the user cancels the picker. Nothing else returns
//     null, so there is no ambiguity.
//   • saveMaxpat() THROWS PickerCancelled when the user cancels, because `undefined` is
//     already taken: it means "written, but through the download fallback, so there is no
//     handle to re-save into". A caller that treated cancel as success would announce
//     "Saved fm_synth.maxpat" over a dialog the user had just dismissed.
//
// Drop is bound to the CANVAS, never to the document. src/main.ts (the player page)
// installs a document-level drop handler, the palette and the Python drawer will each
// want their own, and a page with one global handler cannot ever grow a second target.
// installCanvasDrop() therefore calls stopPropagation() on the events it claims — and
// only on those, so a drop it does not understand still reaches whatever else is
// listening.

/** The dataTransfer type the object palette drags with. Shared so both ends agree. */
export const MAXOBJECT_MIME = 'application/x-maxobject';

/** Extensions we offer to open. `.json` because a Max patch is JSON and people rename. */
const PATCH_EXTENSIONS = /\.(maxpat|json)$/i;

/** The picker's file-type filter, in the one shape both pickers take. */
const PATCH_TYPES = [
  { description: 'Max patch', accept: { 'application/json': ['.maxpat', '.json'] } },
];

/** A patch that was opened, and the handle to save it back through (if we got one). */
export interface OpenedPatch {
  /** The parsed .maxpat JSON. Caller passes it to parseMaxPat(). */
  json: unknown;
  /** File name, for the title bar and for the next save. */
  name: string;
  /** Present only on the File System Access path — this is what makes ⌘S save in place. */
  handle?: FileSystemFileHandle;
}

/** Thrown by saveMaxpat() when the user dismisses the picker. See the module header. */
export class PickerCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'PickerCancelled';
  }
}

/** Where a drop landed, in client coordinates. The canvas converts to patch space. */
export interface DropPoint {
  clientX: number;
  clientY: number;
}

/**
 * What a drop can mean. Every handler is optional: a page that only wants files installs
 * only `onFile`, and the other payloads are then ignored (and left to bubble, so nothing
 * else on the page loses them).
 */
export interface CanvasDropHandlers {
  /** A .maxpat/.json file was dropped. The whole document is being replaced. */
  onFile?(file: File, at: DropPoint): void | Promise<void>;
  /** An object name dragged out of the palette — create that box at `at`. */
  onObject?(name: string, at: DropPoint): void;
  /**
   * Patcher JSON as text: a `{boxes, lines}` fragment copied out of this patcher, or a
   * whole `{patcher: …}` file pasted as text. Same payload ⌘V accepts.
   */
  onFragment?(text: string, at: DropPoint): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// File System Access API
//
// Typed locally rather than through @types/wicg-file-system-access, which would be a new
// dev dependency for two function signatures. `FileSystemFileHandle` itself IS in
// lib.dom; only the two window-level pickers are missing from it.
// ─────────────────────────────────────────────────────────────────────────────

interface FilePickerOptions {
  types?: { description?: string; accept: Record<string, string[]> }[];
  excludeAcceptAllOption?: boolean;
  suggestedName?: string;
  multiple?: boolean;
  /** Makes the browser reopen the picker in the directory it was last used in. */
  id?: string;
}

interface FilePickers {
  showOpenFilePicker?(options?: FilePickerOptions): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(options?: FilePickerOptions): Promise<FileSystemFileHandle>;
}

/** Non-standard but universal on the handles Chrome hands out; absent elsewhere. */
interface PermissionedHandle {
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

function pickers(): FilePickers {
  return (typeof window === 'undefined' ? {} : window) as FilePickers;
}

/** A dismissed picker rejects with an AbortError; anything else is a real failure. */
function isAbort(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'AbortError';
}

/**
 * Has the user still granted us write access to this handle?
 *
 * A handle survives a reload (it can be kept in IndexedDB) but the permission does not,
 * so re-saving into a handle from a previous session needs the grant re-requested —
 * which browsers only allow from inside a user gesture, which ⌘S is. Anything other than
 * a clear 'granted' is treated as "ask the picker instead" rather than as an error.
 */
async function canWrite(handle: FileSystemFileHandle): Promise<boolean> {
  const permissioned = handle as FileSystemFileHandle & PermissionedHandle;
  if (typeof permissioned.queryPermission !== 'function') return true; // nothing to ask
  try {
    if ((await permissioned.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
    return (await permissioned.requestPermission?.({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// open
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ask for a patch and read it.
 *
 * Resolves null if the user cancels. Throws if the file cannot be read or is not JSON —
 * with the file's name in the message, because "Unexpected token }" on its own tells the
 * user nothing about which file they just chose.
 */
export async function openMaxpat(): Promise<OpenedPatch | null> {
  const showOpenFilePicker = pickers().showOpenFilePicker;
  if (showOpenFilePicker) {
    let handle: FileSystemFileHandle | undefined;
    try {
      [handle] = await showOpenFilePicker({ types: PATCH_TYPES, multiple: false, id: 'maxpat' });
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
    // An empty array is not something a browser is supposed to return here, but reading
    // `.getFile()` off undefined would blame this module for someone else's bug.
    if (!handle) return null;
    const file = await handle.getFile();
    return { json: await readPatchFile(file), name: file.name, handle };
  }

  const file = await pickFileWithInput();
  if (!file) return null;
  return { json: await readPatchFile(file), name: file.name };
}

/** Parse one file as a patch. Exported behaviour is the error message, so it is here. */
async function readPatchFile(file: File): Promise<unknown> {
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${file.name} is not a readable .maxpat: ${(err as Error).message}`);
  }
}

/**
 * The fallback picker: a detached <input type=file>, clicked.
 *
 * The awkward part is cancellation, because for twenty years there was no event for it.
 * Modern browsers fire `cancel`, but Safari only learned to in 16.4, and a promise that
 * never settles would leak the caller's `await` forever — so there is a third path:
 * when the window regains focus and no `change` has arrived by the next macrotask, the
 * dialog was dismissed. Whichever fires first wins and the rest are torn down.
 */
function pickFileWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.maxpat,.json,application/json';
    // Off-screen rather than display:none — a hidden input is ignored by some browsers.
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);

    let settled = false;
    const finish = (file: File | null): void => {
      if (settled) return;
      settled = true;
      input.removeEventListener('change', onChange);
      input.removeEventListener('cancel', onCancel);
      removeEventListener('focus', onFocus);
      input.remove();
      resolve(file);
    };
    const onChange = (): void => finish(input.files?.[0] ?? null);
    const onCancel = (): void => finish(null);
    const onFocus = (): void => {
      // One macrotask of grace: `focus` beats `change` when a file WAS chosen.
      setTimeout(() => finish(null), 300);
    };

    input.addEventListener('change', onChange);
    input.addEventListener('cancel', onCancel);
    addEventListener('focus', onFocus);
    input.click();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// save
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write the patch out, in place when we can.
 *
 * @param handle From a previous open/save. Given one, this writes straight through it
 *   with no dialog — that is the whole point of keeping it.
 * @returns The handle to reuse next time, or undefined when the download fallback ran
 *   (there is no file to write back into).
 * @throws PickerCancelled if the user dismisses the picker.
 */
export async function saveMaxpat(
  json: unknown,
  name: string,
  handle?: FileSystemFileHandle
): Promise<FileSystemFileHandle | undefined> {
  const text = JSON.stringify(json, null, 2);
  const fileName = name.endsWith('.maxpat') ? name : `${name.replace(/\.json$/i, '')}.maxpat`;

  if (handle && (await canWrite(handle))) {
    // No try/catch: a write that fails here (the file was deleted, the volume is gone)
    // is a real error the caller must show. Only a REFUSED PERMISSION falls back, and
    // canWrite() has already turned that into a false.
    await writeHandle(handle, text);
    return handle;
  }

  const showSaveFilePicker = pickers().showSaveFilePicker;
  if (showSaveFilePicker) {
    let picked: FileSystemFileHandle;
    try {
      picked = await showSaveFilePicker({
        suggestedName: fileName,
        types: PATCH_TYPES,
        id: 'maxpat',
      });
    } catch (err) {
      if (isAbort(err)) throw new PickerCancelled();
      throw err;
    }
    await writeHandle(picked, text);
    return picked;
  }

  downloadBlob(text, fileName);
  return undefined;
}

async function writeHandle(handle: FileSystemFileHandle, text: string): Promise<void> {
  const stream = await handle.createWritable();
  try {
    await stream.write(text);
  } finally {
    // close() both flushes and releases the lock on the file. Skipping it on an error
    // would leave the file locked for the rest of the session.
    await stream.close();
  }
}

/**
 * The no-API path: a Blob URL and a synthetic click.
 *
 * The object URL is revoked on the next macrotask rather than immediately — the click
 * only *starts* the download, and revoking in the same tick cancels it in Safari.
 */
function downloadBlob(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// drop
// ─────────────────────────────────────────────────────────────────────────────

/** What, if anything, this drop carries for us. Read from `types` — see below. */
function payloadKind(dt: DataTransfer | null): 'object' | 'file' | 'text' | null {
  if (!dt) return null;
  const types = Array.from(dt.types ?? []);
  // Order matters: a palette drag sets text/plain as a courtesy fallback for other
  // targets, so the specific type has to be tested before the generic one. Files last
  // of the two "real" payloads because nothing else can produce a Files entry.
  if (types.includes(MAXOBJECT_MIME)) return 'object';
  if (types.includes('Files')) return 'file';
  if (types.includes('text/plain')) return 'text';
  return null;
}

/** The patch file out of a drop, preferring an extension we recognise. */
function patchFile(dt: DataTransfer): File | null {
  const files = Array.from(dt.files ?? []);
  // A Max patch saved without an extension still opens: if nothing matches, the first
  // file is tried anyway and readPatchFile()'s error is a better report than silence.
  return files.find((f) => PATCH_EXTENSIONS.test(f.name)) ?? files[0] ?? null;
}

/**
 * Accept drops on the canvas. Returns the teardown thunk.
 *
 * `dragover` must preventDefault or the browser navigates to the dropped file instead —
 * and it must do so ONLY for payloads we actually handle, or this element becomes a
 * black hole for every drag on the page. That decision is made from `dataTransfer.types`
 * because during a drag the data itself is unreadable by design (drag-and-drop protected
 * mode); `getData` only works in the `drop` handler.
 *
 * The element gets `is-drop-target` while a drag it would accept is over it. Styling it
 * is optional — no stylesheet is required for any of this to work.
 */
export function installCanvasDrop(el: HTMLElement, handlers: CanvasDropHandlers): () => void {
  // dragenter/dragleave fire for every child the pointer crosses, so "am I still inside"
  // is a depth count, not a boolean. Without it the highlight flickers off the moment
  // the cursor passes over a box.
  let depth = 0;

  const setActive = (on: boolean): void => {
    if (!on) depth = 0;
    el.classList.toggle('is-drop-target', on);
  };

  const wanted = (e: DragEvent): 'object' | 'file' | 'text' | null => {
    const kind = payloadKind(e.dataTransfer);
    if (kind === 'object' && handlers.onObject) return kind;
    if (kind === 'file' && handlers.onFile) return kind;
    if (kind === 'text' && handlers.onFragment) return kind;
    return null;
  };

  const onEnter = (e: DragEvent): void => {
    if (!wanted(e)) return;
    depth++;
    setActive(true);
  };

  const onLeave = (e: DragEvent): void => {
    if (!wanted(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) setActive(false);
  };

  const onOver = (e: DragEvent): void => {
    if (!wanted(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };

  const onDrop = (e: DragEvent): void => {
    const kind = wanted(e);
    setActive(false);
    if (!kind) return;
    e.preventDefault();
    e.stopPropagation();
    const dt = e.dataTransfer!;
    const at: DropPoint = { clientX: e.clientX, clientY: e.clientY };

    if (kind === 'object') {
      const name = dt.getData(MAXOBJECT_MIME).trim();
      if (name) handlers.onObject!(name, at);
      return;
    }
    if (kind === 'file') {
      const file = patchFile(dt);
      if (file) void handlers.onFile!(file, at);
      return;
    }
    const text = dt.getData('text/plain').trim();
    // Only something that could BE a patch fragment is forwarded. Dropping a selected
    // word from another page should do nothing, not raise "nothing this patcher can
    // read" — the user was not trying to paste a patch.
    if (text.startsWith('{') || text.startsWith('[')) handlers.onFragment!(text, at);
  };

  el.addEventListener('dragenter', onEnter);
  el.addEventListener('dragleave', onLeave);
  el.addEventListener('dragover', onOver);
  el.addEventListener('drop', onDrop);

  return () => {
    setActive(false);
    el.removeEventListener('dragenter', onEnter);
    el.removeEventListener('dragleave', onLeave);
    el.removeEventListener('dragover', onOver);
    el.removeEventListener('drop', onDrop);
  };
}
