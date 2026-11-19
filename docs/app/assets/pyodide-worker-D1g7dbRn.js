const i=s=>self.postMessage(s);let o=null;const c=s=>i({type:"status",message:s});async function y(s,e){c("downloading Python runtime…");const{loadPyodide:p}=await import(`${s}pyodide.mjs`),n=await p({indexURL:s});c("loading numpy…"),await n.loadPackage(["numpy","micropip"]);const t=n.pyimport("micropip");c("installing maxpylang…"),await t.install("tabulate");const a=e.split("/").pop()||"maxpylang.whl",r=new Uint8Array(await(await fetch(e)).arrayBuffer());return n.FS.writeFile(`/tmp/${a}`,r),await t.install(`emfs:/tmp/${a}`,{deps:!1}),n.runPython(`
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
`),c("ready"),n}self.onmessage=async s=>{var p,n;const e=s.data;if(e.type==="init"){o=o||y(e.pyodideCdn,e.wheelUrl);try{await o,i({type:"ready"})}catch(t){i({type:"error",phase:"init",message:String(t.message||t)})}return}if(e.type==="install"){try{const t=await o;if(!t)throw new Error("runtime not initialised");const a=String(e.dir);t.FS.mkdirTree(a);const r=new TextEncoder;for(const[l,d]of Object.entries(e.files))t.FS.writeFile(`${a}/${l}`,r.encode(d));t.globals.get("__add_path")(a),i({type:"result",id:e.id,json:""})}catch(t){i({type:"error",id:e.id,phase:"install",message:String(t.message||t)})}return}if(e.type==="call"){try{const t=await o;if(!t)throw new Error("runtime not initialised");const a=t.pyimport(String(e.module)),r=a[String(e.fn)](...e.args);(p=a.destroy)==null||p.call(a),i({type:"result",id:e.id,json:String(r)})}catch(t){i({type:"error",id:e.id,phase:"call",message:String(t.message||t)})}return}if(e.type==="compile")try{const t=await o;if(!t)throw new Error("runtime not initialised");const a=t.globals.get("__compile"),r=a(e.source);(n=a.destroy)==null||n.call(a),i({type:"result",id:e.id,json:r})}catch(t){i({type:"error",id:e.id,phase:"compile",message:String(t.message||t)})}};
