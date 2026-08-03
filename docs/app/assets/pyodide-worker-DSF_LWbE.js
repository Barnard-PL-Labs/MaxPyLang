const n=e=>self.postMessage(e);let o=null;const p=e=>n({type:"status",message:e});async function l(e,t){p("downloading Python runtime…");const{loadPyodide:i}=await import(`${e}pyodide.mjs`),a=await i({indexURL:e});p("loading numpy…"),await a.loadPackage(["numpy","micropip"]);const s=a.pyimport("micropip");p("installing maxpylang…"),await s.install("tabulate");const r=t.split("/").pop()||"maxpylang.whl",c=new Uint8Array(await(await fetch(t)).arrayBuffer());return a.FS.writeFile(`/tmp/${r}`,c),await s.install(`emfs:/tmp/${r}`,{deps:!1}),a.runPython(`
import json, maxpylang as mp

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
`),p("ready"),a}self.onmessage=async e=>{var i;const t=e.data;if(t.type==="init"){o=o||l(t.pyodideCdn,t.wheelUrl);try{await o,n({type:"ready"})}catch(a){n({type:"error",phase:"init",message:String(a.message||a)})}return}if(t.type==="compile")try{const a=await o;if(!a)throw new Error("runtime not initialised");const s=a.globals.get("__compile"),r=s(t.source);(i=s.destroy)==null||i.call(s),n({type:"result",id:t.id,json:r})}catch(a){n({type:"error",id:t.id,phase:"compile",message:String(a.message||a)})}};
