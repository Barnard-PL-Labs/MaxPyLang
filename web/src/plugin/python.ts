// The Python side of the page: maxpylang under Pyodide, in a worker.
//
// The worker is the patcher's own (compiler/pyodide-worker.ts). This page installs
// fxgen.py and schema.json into it and then calls fxgen.run_json() for every build, so
// the device you hear and the file you download both come out of the real library.

import fxgenSource from './fxgen.py?raw';
import schemaSource from './schema.json?raw';
import type { Settings } from './model';

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v314.0.3/full/';
const WHEEL_PATH = 'py/maxpylang-0.1.1-py3-none-any.whl';

export interface Coverage {
  cords?: { total: number; checked: number; flagged: number; not_checked: number; not_checked_because: unknown[] };
  objects?: { total: number; not_seen_into: string[] };
  error?: string;
}

export interface RunResult {
  settings: Settings;
  script: string;
  filename: string;
  json: unknown;
  log: string;
  warnings: { category: string; message: string }[];
  coverage: Coverage;
  /** base64 .amxd, present when asked for. */
  amxd?: string;
}

type Pending = { resolve: (json: string) => void; reject: (e: Error) => void };

export class PyRuntime {
  readonly ready: Promise<void>;
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(onStatus: (message: string) => void) {
    // Vite rewrites this literal `new Worker(new URL(…, import.meta.url))` form into a
    // hashed worker chunk at build time; it has to stay exactly this shape.
    this.worker = new Worker(new URL('../compiler/pyodide-worker.ts', import.meta.url), { type: 'module' });

    let resolveReady!: () => void;
    let rejectReady!: (e: Error) => void;
    const booted = new Promise<void>((res, rej) => { resolveReady = res; rejectReady = rej; });

    this.worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; id?: number; json?: string; message?: string; phase?: string };
      if (m.type === 'status') return onStatus(m.message ?? '');
      if (m.type === 'ready') return resolveReady();
      if (m.type === 'error' && m.phase === 'init') return rejectReady(new Error(m.message));
      const p = m.id !== undefined ? this.pending.get(m.id) : undefined;
      if (!p || m.id === undefined) return;
      this.pending.delete(m.id);
      if (m.type === 'result') p.resolve(m.json ?? '');
      else p.reject(new Error(m.message ?? 'Python error'));
    };
    this.worker.onerror = (e: ErrorEvent) => rejectReady(new Error(e.message || 'the Python worker failed to start'));

    const wheelUrl = new URL(import.meta.env.BASE_URL + WHEEL_PATH, location.href).href;
    this.worker.postMessage({ type: 'init', pyodideCdn: PYODIDE_CDN, wheelUrl });

    this.ready = booted.then(async () => {
      onStatus('loading the generator…');
      await this.send({ type: 'install', dir: '/fxgen', files: { 'fxgen.py': fxgenSource, 'schema.json': schemaSource } });
    });
    this.ready.catch(() => {});
  }

  private send(message: Record<string, unknown>): Promise<string> {
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...message, id });
    });
  }

  /** Generate the device for `settings`. `wantAmxd` also returns the .amxd bytes. */
  async run(settings: Settings, wantAmxd = false): Promise<RunResult> {
    await this.ready;
    const json = await this.send({ type: 'call', module: 'fxgen', fn: 'run_json', args: [JSON.stringify(settings), wantAmxd] });
    return JSON.parse(json) as RunResult;
  }
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
