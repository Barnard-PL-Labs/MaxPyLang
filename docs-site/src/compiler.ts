// Compile edited example code in the browser, with Python (Pyodide) in a Web Worker.
//
// The worker is the web app's own (web/src/compiler/pyodide-worker.ts), used as-is. It
// starts only the first time someone runs edited code: Pyodide is ~15 MB and takes a
// few seconds to start, and unedited examples never need it, because their patches
// were compiled at build time.
//
// The wheel it installs is built from this repo's maxpylang at build time
// (scripts/build_examples.py writes public/py/ and src/generated/wheel.json), so edits
// run the same maxpylang the examples were compiled with.

import wheel from './generated/wheel.json';

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v314.0.3/full/';

type Reply =
  | { type: 'status'; message: string }
  | { type: 'ready' }
  | { type: 'result'; id: number; json: string }
  | { type: 'error'; id?: number; phase: 'init' | 'compile'; message: string };

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (json: unknown) => void; reject: (e: Error) => void }>();
const statusListeners = new Set<(message: string) => void>();

export function onStatus(f: (message: string) => void): () => void {
  statusListeners.add(f);
  return () => statusListeners.delete(f);
}

export const pythonLoaded = (): boolean => worker !== null;

function start(): Promise<void> {
  if (ready) return ready;
  ready = new Promise<void>((resolve, reject) => {
    worker = new Worker(new URL('../../web/src/compiler/pyodide-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<Reply>) => {
      const msg = e.data;
      if (msg.type === 'status') statusListeners.forEach((f) => f(msg.message));
      else if (msg.type === 'ready') resolve();
      else if (msg.type === 'result') {
        pending.get(msg.id)?.resolve(JSON.parse(msg.json));
        pending.delete(msg.id);
      } else if (msg.type === 'error') {
        if (msg.phase === 'init') {
          ready = null; // let the next run try again
          reject(new Error(msg.message));
        } else if (msg.id !== undefined) {
          pending.get(msg.id)?.reject(new Error(msg.message));
          pending.delete(msg.id);
        }
      }
    };
    const wheelUrl = new URL(import.meta.env.BASE_URL + 'py/' + wheel.file, location.href).href;
    worker.postMessage({ type: 'init', pyodideCdn: PYODIDE_CDN, wheelUrl });
  });
  return ready;
}

/** Run a maxpylang script and return the patch it saves (maxpat JSON). */
export async function compile(source: string): Promise<unknown> {
  await start();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ type: 'compile', id, source });
  });
}

/** The line of a Python traceback worth showing: the last non-empty one. */
export function lastLine(message: string): string {
  const lines = message.trim().split('\n').filter((l) => l.trim());
  return lines[lines.length - 1] ?? message;
}
