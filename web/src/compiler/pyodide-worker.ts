// Pyodide worker: runs maxpylang (Python, in WASM) off the main thread and turns
// MaxPy source into .maxpat JSON. The main thread feeds that JSON to the existing
// engine. Kept off-main-thread so Python execution never stalls the AudioContext/UI.
//
// Protocol (main <-> worker):
//   → {type:'init', pyodideCdn, wheelUrl}
//   ← {type:'status', message}         (load progress)
//   ← {type:'ready'} | {type:'error', phase:'init', message}
//   → {type:'compile', id, source}
//   ← {type:'result', id, json} | {type:'error', id, phase:'compile', message}
//   → {type:'install', id, dir, files: {name: text}}   (put Python modules on sys.path)
//   ← {type:'result', id, json: ''} | {type:'error', id, phase:'install', message}
//   → {type:'call', id, module, fn, args: (string|number|boolean)[]}
//   ← {type:'result', id, json} | {type:'error', id, phase:'call', message}
//
// `install` + `call` are how a page runs its OWN Python against maxpylang (the plugin
// generator's fxgen.py) instead of a script the user typed. The function must return a
// string; by convention it is JSON, which is why the reply reuses the `json` field.

// We rely on the ambient `self`/`postMessage` from the DOM lib rather than pulling
// the WebWorker lib (which would clash with DOM's `self` in the shared tsc program).
const post = (message: unknown) => (self as unknown as { postMessage(m: unknown): void }).postMessage(message);

interface Pyodide {
  loadPackage(names: string[]): Promise<void>;
  pyimport(name: string): any;
  runPython(code: string): unknown;
  FS: { writeFile(path: string, data: Uint8Array): void; mkdirTree(path: string): void };
  globals: { get(name: string): any };
}

let ready: Promise<Pyodide> | null = null;

const postStatus = (message: string) => post({ type: 'status', message });

async function init(pyodideCdn: string, wheelUrl: string): Promise<Pyodide> {
  postStatus('downloading Python runtime…');
  const { loadPyodide } = await import(/* @vite-ignore */ `${pyodideCdn}pyodide.mjs`);
  const py: Pyodide = await loadPyodide({ indexURL: pyodideCdn });

  postStatus('loading numpy…');
  await py.loadPackage(['numpy', 'micropip']);
  const micropip = py.pyimport('micropip');

  postStatus('installing maxpylang…');
  await micropip.install('tabulate');
  const wheelName = wheelUrl.split('/').pop() || 'maxpylang.whl';
  const bytes = new Uint8Array(await (await fetch(wheelUrl)).arrayBuffer());
  py.FS.writeFile(`/tmp/${wheelName}`, bytes);
  await micropip.install(`emfs:/tmp/${wheelName}`, { deps: false });

  // A compile helper: run the user's script, intercept patch.save(...) to capture
  // the JSON (so ordinary MaxPy scripts "just work"), and fall back to finding a
  // MaxPatch instance in the namespace if they never call save.
  py.runPython(`
import json, sys, importlib, maxpylang as mp

def __add_path(d):
    if d not in sys.path:
        sys.path.insert(0, d)
    importlib.invalidate_caches()

def __compile(src):
    captured = {}
    original = mp.MaxPatch.save
    def _save(self, *a, **k):
        captured['json'] = self.get_json()
    mp.MaxPatch.save = _save
    ns = {}
    try:
        exec(src, ns)
    finally:
        mp.MaxPatch.save = original
    if 'json' not in captured:
        for v in ns.values():
            if isinstance(v, mp.MaxPatch):
                captured['json'] = v.get_json()
                break
    if 'json' not in captured:
        raise ValueError("No patch found. Build a MaxPatch and call patch.save('my.maxpat').")
    return json.dumps(captured['json'])
`);

  postStatus('ready');
  return py;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === 'init') {
    ready = ready || init(msg.pyodideCdn, msg.wheelUrl);
    try {
      await ready;
      post({ type: 'ready' });
    } catch (err) {
      post({ type: 'error', phase: 'init', message: String((err as Error).message || err) });
    }
    return;
  }
  if (msg.type === 'install') {
    try {
      const py = await ready;
      if (!py) throw new Error('runtime not initialised');
      const dir = String(msg.dir);
      py.FS.mkdirTree(dir);
      const enc = new TextEncoder();
      for (const [name, text] of Object.entries(msg.files as Record<string, string>)) {
        py.FS.writeFile(`${dir}/${name}`, enc.encode(text));
      }
      py.globals.get('__add_path')(dir);
      post({ type: 'result', id: msg.id, json: '' });
    } catch (err) {
      post({ type: 'error', id: msg.id, phase: 'install', message: String((err as Error).message || err) });
    }
    return;
  }
  if (msg.type === 'call') {
    try {
      const py = await ready;
      if (!py) throw new Error('runtime not initialised');
      const mod = py.pyimport(String(msg.module));
      const out = mod[String(msg.fn)](...(msg.args as unknown[]));
      mod.destroy?.();
      post({ type: 'result', id: msg.id, json: String(out) });
    } catch (err) {
      post({ type: 'error', id: msg.id, phase: 'call', message: String((err as Error).message || err) });
    }
    return;
  }
  if (msg.type === 'compile') {
    try {
      const py = await ready;
      if (!py) throw new Error('runtime not initialised');
      const compile = py.globals.get('__compile');
      const json = compile(msg.source) as string;
      compile.destroy?.();
      post({ type: 'result', id: msg.id, json });
    } catch (err) {
      // Python tracebacks arrive as the error message — surface them verbatim.
      post({ type: 'error', id: msg.id, phase: 'compile', message: String((err as Error).message || err) });
    }
  }
};
