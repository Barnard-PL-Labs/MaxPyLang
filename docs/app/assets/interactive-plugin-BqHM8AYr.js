import{H as Ne,I as ne,n as Pe,m as se,o as ae,J as Re,E as $e,B as Oe,p as je,K as Xe}from"./layout-BK990_Rb.js";const oe=.015;class Be{constructor(t){this.buffers=new Map,this.bypassed=!1,this.playing=!1,this.ctx=t;const n=Ne(t);this.feed=new GainNode(t,{gain:1,channelCount:2,channelCountMode:"explicit",channelInterpretation:"speakers"});const s=new ChannelSplitterNode(t,{numberOfOutputs:2});this.feed.connect(s),s.connect(n.input[0],0),s.connect(n.input[1],1),this.wet=new GainNode(t,{gain:1}),this.dry=new GainNode(t,{gain:0}),this.master=new GainNode(t,{gain:1}),this.analyser=new AnalyserNode(t,{fftSize:2048,smoothingTimeConstant:.82}),n.output.disconnect(),n.output.connect(this.wet).connect(this.master),this.feed.connect(this.dry).connect(this.master),this.master.connect(this.analyser),this.master.connect(t.destination),this.meterSplit=new ChannelSplitterNode(t,{numberOfOutputs:2}),this.master.connect(this.meterSplit),this.meters=[0,1].map(o=>{const c=new AnalyserNode(t,{fftSize:512});return this.meterSplit.connect(c,o),c}),this.meterData=this.meters.map(o=>new Float32Array(new ArrayBuffer(o.fftSize*4)))}load(t){let n=this.buffers.get(t.id);return n||(n=fetch(t.url).then(s=>{if(!s.ok)throw new Error(`could not load ${t.label} (${s.status})`);return s.arrayBuffer()}).then(s=>this.ctx.decodeAudioData(s)),n.catch(()=>this.buffers.delete(t.id)),this.buffers.set(t.id,n)),n}decode(t){return this.ctx.decodeAudioData(t)}setBuffer(t){this.buffer=t,this.playing&&this.startSource()}startSource(){if(this.stopSource(),!this.buffer)return;const t=new AudioBufferSourceNode(this.ctx,{buffer:this.buffer,loop:!0});t.connect(this.feed),t.start(),this.source=t}stopSource(){const t=this.source;if(this.source=void 0,!!t){try{t.stop()}catch{}try{t.disconnect()}catch{}}}play(){this.playing=!0,this.startSource()}stop(){this.playing=!1,this.stopSource()}get bypass(){return this.bypassed}set bypass(t){this.bypassed=t;const n=this.ctx.currentTime;this.wet.gain.cancelScheduledValues(n),this.dry.gain.cancelScheduledValues(n),this.wet.gain.setTargetAtTime(t?0:1,n,oe),this.dry.gain.setTargetAtTime(t?1:0,n,oe)}async duck(t){if(!this.playing||this.ctx.state!=="running")return t();const n=this.master.gain;n.cancelScheduledValues(this.ctx.currentTime),n.setTargetAtTime(0,this.ctx.currentTime,.006),await new Promise(s=>setTimeout(s,30));try{return t()}finally{n.cancelScheduledValues(this.ctx.currentTime),n.setTargetAtTime(1,this.ctx.currentTime+.01,.012)}}levels(){const t=[];for(let n=0;n<2;n++){const s=this.meterData[n];this.meters[n].getFloatTimeDomainData(s);let o=0;for(const c of s)o=Math.max(o,Math.abs(c));t.push(o)}return[t[0],t[1]]}}const be="http://www.w3.org/2000/svg",ve=169;function ie(e,t){if(!Array.isArray(e)||e.length<3)return t;const[n,s,o,c=1]=e.map(Number);if(![n,s,o,c].every(Number.isFinite))return t;const l=a=>Math.round(Math.min(1,Math.max(0,a))*255);return`rgba(${l(n)}, ${l(s)}, ${l(o)}, ${c})`}function ze(e){var n;return(((n=e==null?void 0:e.patcher)==null?void 0:n.boxes)??[]).map(s=>s.box).filter(s=>!!s)}function Fe(e,t,n){var c,l;e.replaceChildren();const s=ze(t).filter(a=>Number(a.presentation)===1&&Array.isArray(a.presentation_rect));s.sort((a,d)=>Number(d.background??0)-Number(a.background??0));let o=Number((c=t==null?void 0:t.patcher)==null?void 0:c.devicewidth)||0;for(const a of s){const[d,p,i,m]=a.presentation_rect.map(Number);o=Math.max(o,d+i);const u=document.createElement("div");switch(u.style.cssText=`position:absolute;left:${d}px;top:${p}px;width:${i}px;height:${m}px;`,a.maxclass){case"panel":u.className="dv-panel",u.style.background=ie(a.bgcolor,"#1c1e23"),u.style.borderRadius=`${Number(a.rounded??0)}px`;break;case"live.comment":case"comment":{u.className="dv-label",u.textContent=String(a.text??""),u.style.fontSize=`${Number(a.fontsize??10)}px`,u.style.fontWeight=Number(a.fontface??0)===1?"700":"400",u.style.color=ie(a.textcolor,"#d5d9e0"),u.style.textAlign=Number(a.textjustification??0)===1?"center":"left",u.style.lineHeight=`${m}px`;break}default:{const h=(l=n.get(String(a.id)))==null?void 0:l.el;if(!h)continue;u.className="dv-widget",u.appendChild(h)}}e.appendChild(u)}return e.style.width=`${o}px`,e.style.height=`${ve}px`,o}const Ie=new Set(["panel","live.comment"]);function H(e){var t;return e.maxclass==="live.dial"?Re(e.raw,"live.dial").longname:e.maxclass==="comment"?String(((t=e.raw)==null?void 0:t.text)??e.text):e.text||e.className}function v(e,t,n){const s=document.createElementNS(be,t);for(const[o,c]of Object.entries(n))s.setAttribute(o,String(c));return e.appendChild(s),s}function He(e,t){e.replaceChildren();const n=new Map;let s=0;for(const i of t.nodes){if(Ie.has(i.maxclass)){s++;continue}const[m,u,h,M]=i.rect,b=i.maxclass==="live.dial",_=i.maxclass==="comment",D=b?Math.max(h,ne(H(i))+30):Math.max(_?0:h,ne(H(i))+14);n.set(i.id,{x:m,y:u,w:D,h:b?30:Math.max(22,Math.min(M,22)),node:i,authoredRect:[...i.rect]})}let o=0,c=0;for(const i of n.values())o=Math.max(o,i.x+i.w),c=Math.max(c,i.y+i.h);const l=28,a=document.createElementNS(be,"svg");a.setAttribute("viewBox",`0 0 ${o+l} ${c+l}`),a.setAttribute("width",String(o+l)),a.setAttribute("height",String(c+l)),a.classList.add("pv");const d=v(a,"g",{class:"pv-cords"});for(const i of t.edges){const m=n.get(i.from.id),u=n.get(i.to.id);!m||!u||v(d,"path",{d:Pe(ae(m,i.from.outlet),se(u,i.to.inlet)),class:i.domain==="signal"?"pv-cord is-signal":"pv-cord"})}const p=v(a,"g",{class:"pv-boxes"});for(const i of n.values()){const m=v(p,"g",{transform:`translate(${i.x} ${i.y})`}),u=H(i.node);if(i.node.maxclass==="comment"){v(m,"text",{x:0,y:15,class:"pv-comment"}).textContent=u;continue}const h=i.node.maxclass==="live.dial",M=i.node.outletDomains.includes("signal")||i.node.className.endsWith("~");v(m,"rect",{width:i.w,height:i.h,rx:4,class:`pv-box${M?" is-signal":""}${h?" is-dial":""}`}),h&&(v(m,"circle",{cx:15,cy:15,r:7.5,class:"pv-knob"}),v(m,"line",{x1:15,y1:15,x2:19.5,y2:10.5,class:"pv-knob-needle"})),v(m,"text",{x:h?29:7,y:i.h/2+4,class:"pv-text"}).textContent=u;for(let b=0;b<i.node.numInlets;b++){const _=se(i,b);v(m,"rect",{x:_.x-i.x-3.5,y:-1,width:7,height:3,rx:1,class:"pv-port"})}for(let b=0;b<i.node.numOutlets;b++){const _=ae(i,b);v(m,"rect",{x:_.x-i.x-3.5,y:i.h-2,width:7,height:3,rx:1,class:`pv-port${i.node.outletDomains[b]==="signal"?" is-signal":""}`})}}return e.appendChild(a),s}const X=e=>e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"),We=/\b(import|as|def|return|if|else|for|in|None|True|False)\b/g;function Ue(e){let t=!1;return e.split(`
`).map(n=>{const s=(n.match(/"""|'''/g)??[]).length;if(t||s>0)return s%2===1&&(t=!t),`<span class="c-str">${X(n)}</span>`;const o=Ge(n),c=o<0?n:n.slice(0,o),l=o<0?"":n.slice(o),a=[];let d=0;for(const i of c.matchAll(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g))a.push(re(c.slice(d,i.index))),a.push(`<span class="c-str">${X(i[0])}</span>`),d=(i.index??0)+i[0].length;a.push(re(c.slice(d)));const p=l?`<span class="c-com">${X(l).replace(/gap (M4L-\d+)/g,'<span class="c-gap">gap $1</span>')}</span>`:"";return a.join("")+p}).join(`
`)}function re(e){return X(e).replace(new RegExp("(?<![\\w.])(-?\\d+\\.?\\d*)(?![\\w])","g"),'<span class="c-num">$1</span>').replace(We,'<span class="c-kw">$1</span>')}function Ge(e){let t="";for(let n=0;n<e.length;n++){const s=e[n];if(t)s==="\\"?n++:s===t&&(t="");else if(s==='"'||s==="'")t=s;else if(s==="#")return n}return-1}const qe=[{id:"filter",label:"Filter",blurb:"State-variable filter. Sweep it, or park it to shape the tone.",options:[{id:"mode",label:"Type",default:"lowpass",choices:[{id:"lowpass",label:"Low-pass"},{id:"highpass",label:"High-pass"},{id:"bandpass",label:"Band-pass"},{id:"notch",label:"Notch"}]}],params:[{id:"cutoff",label:"Cutoff",min:40,max:18e3,default:1800,unit:"Hz",exponent:3},{id:"res",label:"Reso",min:0,max:.95,default:.35,unit:"",exponent:1}]},{id:"drive",label:"Drive",blurb:"Saturation, from a warm push to a hard clip, with a tone control after it.",options:[{id:"character",label:"Character",default:"soft",choices:[{id:"soft",label:"Soft (overdrive~)"},{id:"hard",label:"Hard (clip~)"}]}],params:[{id:"amount",label:"Drive",min:1,max:12,default:3,unit:"x",exponent:1.5},{id:"tone",label:"Tone",min:400,max:18e3,default:9e3,unit:"Hz",exponent:3}]},{id:"crush",label:"Crush",blurb:"Bit depth and sample rate reduction with degrade~. Lo-fi on demand.",options:[],params:[{id:"rate",label:"Rate",min:2,max:100,default:35,unit:"%",exponent:2},{id:"bits",label:"Bits",min:2,max:16,default:8,unit:"bit",exponent:1,integer:!0}]},{id:"chorus",label:"Chorus",blurb:"A modulated delay line per channel, moving in opposite directions for width.",options:[],params:[{id:"rate",label:"Rate",min:.05,max:8,default:.6,unit:"Hz",exponent:2},{id:"depth",label:"Depth",min:0,max:8,default:3,unit:"ms",exponent:1},{id:"mix",label:"Mix",min:0,max:100,default:50,unit:"%",exponent:1}]},{id:"tremolo",label:"Tremolo",blurb:"An LFO on the volume. Switch to auto-pan to move it between the speakers.",options:[{id:"mode",label:"Mode",default:"tremolo",choices:[{id:"tremolo",label:"Tremolo"},{id:"autopan",label:"Auto-pan"}]}],params:[{id:"rate",label:"Rate",min:.1,max:20,default:5,unit:"Hz",exponent:2},{id:"depth",label:"Depth",min:0,max:100,default:60,unit:"%",exponent:1}]},{id:"delay",label:"Delay",blurb:"Feedback delay on a tapin~ / tapout~ pair. Ping-pong bounces it left and right.",options:[{id:"style",label:"Style",default:"stereo",choices:[{id:"stereo",label:"Stereo"},{id:"pingpong",label:"Ping-pong"}]}],params:[{id:"time",label:"Time",min:10,max:1500,default:320,unit:"ms",exponent:2},{id:"feedback",label:"Feedback",short:"Fdbk",min:0,max:95,default:40,unit:"%",exponent:1},{id:"mix",label:"Mix",min:0,max:100,default:30,unit:"%",exponent:1}]},{id:"reverb",label:"Reverb",blurb:"A Schroeder reverb: four comb~ filters into two allpass~ stages per channel.",options:[],params:[{id:"size",label:"Size",min:0,max:100,default:55,unit:"%",exponent:1},{id:"damp",label:"Damp",min:500,max:16e3,default:6e3,unit:"Hz",exponent:3},{id:"mix",label:"Mix",min:0,max:100,default:25,unit:"%",exponent:1}]}],Ye={id:"output",label:"Output",params:[{id:"gain",label:"Gain",min:-24,max:12,default:0,unit:"dB",exponent:1}]},Je=["#ff7a45","#f5c542","#4bd08a","#38bdf8","#a78bfa","#f472b6"],Ve={modules:qe,output:Ye,accents:Je},Ke=[{id:"tape",name:"Tape Lo-Fi",tag:"Worn cassette: soft crush, dull top, slow wobble",group:"Lo-Fi",sample:"piano",settings:{name:"Tape Lo-Fi",accent:"#f5c542",chain:[{module:"crush",on:!0,options:{},values:{rate:48,bits:11}},{module:"filter",on:!0,options:{mode:"lowpass"},values:{cutoff:3400,res:.2}},{module:"chorus",on:!0,options:{},values:{rate:.35,depth:2.4,mix:38}}],output:{gain:0}}},{id:"arcade",name:"8-Bit Arcade",tag:"Five bits and a tenth of the sample rate",group:"Lo-Fi",sample:"drums",settings:{name:"8-Bit Arcade",accent:"#4bd08a",chain:[{module:"crush",on:!0,options:{},values:{rate:11,bits:5}}],output:{gain:-4}}},{id:"telephone",name:"Telephone",tag:"Narrow band-pass with a clipped edge",group:"Lo-Fi",sample:"vocals",settings:{name:"Telephone",accent:"#f5c542",chain:[{module:"filter",on:!0,options:{mode:"bandpass"},values:{cutoff:1500,res:.5}},{module:"drive",on:!0,options:{character:"hard"},values:{amount:4,tone:3600}}],output:{gain:2}}},{id:"underwater",name:"Underwater",tag:"Everything above 600 Hz gone, and drifting",group:"Lo-Fi",sample:"guitar",settings:{name:"Underwater",accent:"#38bdf8",chain:[{module:"filter",on:!0,options:{mode:"lowpass"},values:{cutoff:620,res:.55}},{module:"chorus",on:!0,options:{},values:{rate:.22,depth:6,mix:60}},{module:"reverb",on:!0,options:{},values:{size:70,damp:1600,mix:40}}],output:{gain:3}}},{id:"tube",name:"Warm Tube",tag:"A gentle push into soft saturation",group:"Drive",sample:"guitar",settings:{name:"Warm Tube",accent:"#ff7a45",chain:[{module:"drive",on:!0,options:{character:"soft"},values:{amount:3.2,tone:7500}}],output:{gain:-3}}},{id:"fuzz",name:"Fuzz Box",tag:"Hard clipping, then a filter to tame it",group:"Drive",sample:"guitar",settings:{name:"Fuzz Box",accent:"#ff7a45",chain:[{module:"drive",on:!0,options:{character:"hard"},values:{amount:10,tone:5200}},{module:"filter",on:!0,options:{mode:"lowpass"},values:{cutoff:4800,res:.3}}],output:{gain:-9}}},{id:"shoegaze",name:"Shoegaze Wall",tag:"Drive into chorus into echo into a long room",group:"Drive",sample:"guitar",settings:{name:"Shoegaze Wall",accent:"#f472b6",chain:[{module:"drive",on:!0,options:{character:"soft"},values:{amount:6,tone:6e3}},{module:"chorus",on:!0,options:{},values:{rate:.5,depth:4,mix:50}},{module:"delay",on:!0,options:{style:"stereo"},values:{time:420,feedback:55,mix:32}},{module:"reverb",on:!0,options:{},values:{size:86,damp:5e3,mix:48}}],output:{gain:-8}}},{id:"slapback",name:"Slapback",tag:"One quick repeat, rockabilly style",group:"Space",sample:"vocals",settings:{name:"Slapback",accent:"#38bdf8",chain:[{module:"delay",on:!0,options:{style:"stereo"},values:{time:115,feedback:6,mix:34}}],output:{gain:0}}},{id:"dub",name:"Dub Echo",tag:"Ping-pong repeats that keep on going",group:"Space",sample:"drums",settings:{name:"Dub Echo",accent:"#4bd08a",chain:[{module:"filter",on:!0,options:{mode:"highpass"},values:{cutoff:320,res:.2}},{module:"delay",on:!0,options:{style:"pingpong"},values:{time:375,feedback:64,mix:40}},{module:"reverb",on:!0,options:{},values:{size:45,damp:4200,mix:14}}],output:{gain:0}}},{id:"cathedral",name:"Cathedral",tag:"A very long, bright tail",group:"Space",sample:"vocals",settings:{name:"Cathedral",accent:"#a78bfa",chain:[{module:"filter",on:!0,options:{mode:"highpass"},values:{cutoff:180,res:.1}},{module:"reverb",on:!0,options:{},values:{size:93,damp:7500,mix:55}}],output:{gain:0}}},{id:"station",name:"Space Station",tag:"Wide echoes dissolving into reverb",group:"Space",sample:"piano",settings:{name:"Space Station",accent:"#a78bfa",chain:[{module:"delay",on:!0,options:{style:"pingpong"},values:{time:540,feedback:70,mix:45}},{module:"reverb",on:!0,options:{},values:{size:82,damp:3600,mix:45}}],output:{gain:-2}}},{id:"surf",name:"Surf Tremolo",tag:"Fast tremolo into a splashy room",group:"Motion",sample:"guitar",settings:{name:"Surf Tremolo",accent:"#38bdf8",chain:[{module:"tremolo",on:!0,options:{mode:"tremolo"},values:{rate:6.5,depth:75}},{module:"reverb",on:!0,options:{},values:{size:52,damp:5200,mix:28}}],output:{gain:1}}},{id:"drift",name:"Auto-Pan Drift",tag:"Slow side-to-side movement with a faint echo",group:"Motion",sample:"piano",settings:{name:"Auto-Pan Drift",accent:"#f472b6",chain:[{module:"tremolo",on:!0,options:{mode:"autopan"},values:{rate:.45,depth:92}},{module:"delay",on:!0,options:{style:"stereo"},values:{time:260,feedback:28,mix:18}}],output:{gain:1}}},{id:"wide",name:"Wide Chorus",tag:"Doubles the sound and spreads it out",group:"Motion",sample:"piano",settings:{name:"Wide Chorus",accent:"#4bd08a",chain:[{module:"chorus",on:!0,options:{},values:{rate:.8,depth:4,mix:50}}],output:{gain:0}}},{id:"sweep",name:"Resonant Low-Pass",tag:"A sharp filter, ready to be swept by hand",group:"Motion",sample:"drums",settings:{name:"Resonant Low-Pass",accent:"#ff7a45",chain:[{module:"filter",on:!0,options:{mode:"lowpass"},values:{cutoff:900,res:.82}}],output:{gain:-4}}},{id:"init",name:"Clean Slate",tag:"Nothing switched on. Build your own from here.",group:"Start",sample:null,settings:{name:"Clean Slate",accent:"#9aa3ad",chain:[],output:{gain:0}}}],w=Ve,we=Ke,J=e=>w.modules.find(t=>t.id===e),le="MaxPy FX";function xe(e,t){let n=Number(t);return Number.isFinite(n)||(n=e.default),n=Math.min(e.max,Math.max(e.min,n)),e.integer?Math.round(n):n}function ce(e,t){var o,c;const n={};for(const l of e.options){const a=(o=t.options)==null?void 0:o[l.id];n[l.id]=l.choices.some(d=>d.id===a)?a:l.default}const s={};for(const l of e.params)s[l.id]=xe(l,((c=t.values)==null?void 0:c[l.id])??l.default);return{module:e.id,on:t.on??!0,options:n,values:s}}function F(e){var a;const t=e&&typeof e=="object"?e:{},n=String(t.name??le).replace(/[^A-Za-z0-9 _-]/g,"").trim().slice(0,32)||le,s=typeof t.accent=="string"&&/^#[0-9a-fA-F]{6}$/.test(t.accent)?t.accent.toLowerCase():w.accents[0],o=[],c=new Set;for(const d of Array.isArray(t.chain)?t.chain:[]){const p=d&&typeof d=="object"?J(d.module):void 0;!p||c.has(p.id)||(c.add(p.id),o.push(ce(p,d)))}for(const d of w.modules)c.has(d.id)||o.push(ce(d,{on:!1}));const l={};for(const d of w.output.params)l[d.id]=xe(d,((a=t.output)==null?void 0:a[d.id])??d.default);return{name:n,accent:s,chain:o,output:l}}function Ze(){const e=(n,s)=>`${n} ${s}`.toLowerCase().replace(/ /g,"_"),t=new Map;for(const n of w.modules)for(const s of n.params)t.set(e(n.label,s.label),{module:n.id,param:s.id});for(const n of w.output.params)t.set(e(w.output.label,n.label),{module:w.output.id,param:n.id});return t}function ye(e){const t={name:e.name,accent:e.accent,chain:e.chain.filter(o=>o.on).map(o=>({module:o.module,on:!0,options:o.options,values:o.values})),output:e.output},n=new TextEncoder().encode(JSON.stringify(t));let s="";for(const o of n)s+=String.fromCharCode(o);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}function Qe(e){try{const t=e.replace(/-/g,"+").replace(/_/g,"/"),n=atob(t),s=Uint8Array.from(n,o=>o.charCodeAt(0));return F(JSON.parse(new TextDecoder().decode(s)))}catch{return}}const et=`"""
fxgen: turn a settings dict into a Max for Live audio effect, using maxpylang.

The interactive plugin page (web/interactive-plugin.html) runs this file in the browser
under Pyodide. It works in two steps, and the split is the point:

    script(settings)  ->  the source of a plain maxpylang program
    run(settings)     ->  executes that program and returns the patch it built

So the Python the page shows is not a description of what happened, it is what ran. Copy
it into a file, \`pip install maxpylang\`, and it writes the same .amxd.

The module list, every dial's range and the presets' vocabulary live in schema.json next
to this file. The page reads the same file to draw its controls, so the two cannot drift.

Where maxpylang has no public way to say something a device needs, the emitted script
reaches into the box dict and says so in a comment that names the entry in
docs/type-system/m4l-gaps.md. Those workarounds are the gap log's evidence.
"""

import base64
import contextlib
import io
import json
import os
import re
import tempfile
import warnings

HERE = os.path.dirname(os.path.abspath(__file__))

SCHEMA = None


def load_schema(source=None):
    """Load schema.json. \`source\` is its text; without it the sibling file is read."""
    global SCHEMA
    if source is None:
        with open(os.path.join(HERE, "schema.json"), encoding="utf-8") as fh:
            source = fh.read()
    SCHEMA = json.loads(source)
    return SCHEMA


def schema():
    return SCHEMA if SCHEMA is not None else load_schema()


# ── settings ────────────────────────────────────────────────────────────────────

DEFAULT_NAME = "MaxPy FX"
NAME_OK = re.compile(r"[^A-Za-z0-9 _\\-]")
HEX_OK = re.compile(r"^#[0-9a-fA-F]{6}$")


def _module(module_id):
    for m in schema()["modules"]:
        if m["id"] == module_id:
            return m
    return None


def _clamp_param(param, value):
    try:
        v = float(value)
    except (TypeError, ValueError):
        v = float(param["default"])
    if v != v:  # NaN
        v = float(param["default"])
    v = min(float(param["max"]), max(float(param["min"]), v))
    return float(round(v)) if param.get("integer") else v


def default_settings():
    return normalize({})


def normalize(settings):
    """
    Fill in and bound a settings dict, so everything after this can trust it.

    The page sends whatever is in its state, a shared link can carry anything, and the
    result is spliced into Python source, so nothing is passed through unchecked: unknown
    modules are dropped, a module listed twice is kept once, every value is clamped to its
    dial's range, and the name is reduced to characters that are safe in a file name.
    """
    sch = schema()
    settings = settings if isinstance(settings, dict) else {}

    name = NAME_OK.sub("", str(settings.get("name") or DEFAULT_NAME)).strip()[:32] or DEFAULT_NAME
    accent = settings.get("accent")
    if not (isinstance(accent, str) and HEX_OK.match(accent)):
        accent = sch["accents"][0]

    chain, seen = [], set()
    given = settings.get("chain")
    for entry in given if isinstance(given, list) else []:
        if not isinstance(entry, dict):
            continue
        mod = _module(entry.get("module"))
        if mod is None or mod["id"] in seen:
            continue
        seen.add(mod["id"])
        chain.append(_normalize_entry(mod, entry))
    for mod in sch["modules"]:
        if mod["id"] not in seen:
            chain.append(_normalize_entry(mod, {"on": False}))

    out_values = (settings.get("output") or {}) if isinstance(settings.get("output"), dict) else {}
    output = {p["id"]: _clamp_param(p, out_values.get(p["id"], p["default"])) for p in sch["output"]["params"]}

    return {"name": name, "accent": accent.lower(), "chain": chain, "output": output}


def _normalize_entry(mod, entry):
    options = entry.get("options") if isinstance(entry.get("options"), dict) else {}
    values = entry.get("values") if isinstance(entry.get("values"), dict) else {}
    opts = {}
    for opt in mod["options"]:
        ids = [c["id"] for c in opt["choices"]]
        opts[opt["id"]] = options.get(opt["id"]) if options.get(opt["id"]) in ids else opt["default"]
    vals = {p["id"]: _clamp_param(p, values.get(p["id"], p["default"])) for p in mod["params"]}
    return {"module": mod["id"], "on": bool(entry.get("on", True)), "options": opts, "values": vals}


def filename(settings):
    return normalize(settings)["name"].replace(" ", "_") + ".amxd"


# ── script emission ─────────────────────────────────────────────────────────────

# Patching-view geometry. Left and right channels run down two columns; each module's
# dials and control math sit in a third; presentation-only boxes are parked in a fourth.
X = {"L": 40, "R": 250}
SUB = 95          # a second object beside the first, inside one channel column
XC = 480          # control column
DX = 135          # between dials
XP = 860          # parked presentation boxes
ROW = 40
GAP = 50
DIAL_ROW = 62     # a live.dial is taller than an object box

# Presentation geometry. A Live device is 169 px tall; the width is ours to set.
DEVICE_H = 169
BRAND_W = 96
CARD_GAP = 6
CARD_PAD = 8
DIAL_W, DIAL_H = 44, 48
DIAL_STEP = 50
CARD_Y, CARD_H = 6, 157
TITLE_Y = 14
DIAL_Y = 72

UNITSTYLE = {"": "FLOAT", "x": "FLOAT", "Hz": "HERTZ", "ms": "MS", "%": "PERCENT", "dB": "DB", "bit": "INT"}

PREAMBLE = '''import maxpylang as mp

patch = mp.MaxPatch(verbose=False)

# Live's parameter_unitstyle values: how Ableton prints a dial's number.
INT, FLOAT, MS, HERTZ, DB, PERCENT = 0, 1, 2, 3, 4, 5


def place(text, x, y, fit=True):
    obj = patch.place(text, verbose=False)[0]
    if fit:
        # An object box as wide as its text, so nothing wraps when Max opens the patch.
        obj.edit(patching_rect=[float(x), float(y), max(40.0, 6.6 * len(text) + 12.0), 22.0])
    else:
        obj.move(float(x), float(y))
    return obj


def box(obj):
    # maxpylang has no public way to set the box keys used below, so this reaches into
    # the box dict. Each use names its entry in docs/type-system/m4l-gaps.md.
    return obj._dict["box"]


def show(obj, x, y, w, h):
    """Put a box in presentation mode, the view Ableton shows. (gap M4L-02)"""
    box(obj)["presentation"] = 1
    box(obj)["presentation_rect"] = [float(x), float(y), float(w), float(h)]


def dial(longname, shortname, at, slot, lo, hi, init, unit, exponent=1.0):
    """A live.dial: a knob Ableton can automate, map and save with the set."""
    d = place("live.dial", *at, fit=False)
    show(d, slot[0], slot[1], 44, 48)
    box(d)["varname"] = longname.lower().replace(" ", "_")
    box(d)["activedialcolor"] = ACCENT
    # The dial's range, unit and starting value. (gap M4L-01)
    box(d)["saved_attribute_attributes"] = {"valueof": {
        "parameter_longname": longname,
        "parameter_shortname": shortname,
        "parameter_type": 1 if unit == INT else 0,
        "parameter_mmin": float(lo),
        "parameter_mmax": float(hi),
        "parameter_initial_enable": 1,
        "parameter_initial": [float(init)],
        "parameter_unitstyle": unit,
        "parameter_exponent": float(exponent),
    }}
    return d


def label(text, at, slot, size=10.0, bold=False, color=None):
    """Text in the device view."""
    c = place("live.comment", *at, fit=False)
    box(c)["text"] = text  # (gap M4L-03)
    box(c)["fontsize"] = float(size)
    box(c)["fontface"] = 1 if bold else 0
    box(c)["textjustification"] = 1 if len(slot) == 4 else 0
    if color:
        box(c)["textcolor"] = color
    show(c, slot[0], slot[1], slot[2] if len(slot) > 2 else 90, 18)
    return c


def card(at, x, w, color):
    """A rounded panel behind one module's dials."""
    p = place("panel", *at, fit=False)
    p.edit(patching_rect=[float(at[0]), float(at[1]), 40.0, 20.0])
    box(p)["bgcolor"] = color
    box(p)["rounded"] = 8
    box(p)["background"] = 1  # (gap M4L-02)
    show(p, x, 6, w, 157)
    return p


def note(text, x, y):
    """A comment in the patching view."""
    c = place("comment", x, y, fit=False)
    c.edit(patching_rect=[float(x), float(y), 260.0, 20.0])
    box(c)["text"] = text  # after edit(), which rewrites the text key (gap M4L-03)
    return c
'''


def fnum(v):
    """A number as Max box text: floats always carry a decimal point (\`0.5\`, \`1800.\`)."""
    s = "%g" % round(float(v), 4)
    if "e" in s:
        s = ("%.6f" % float(v)).rstrip("0")
    return s if "." in s else s + "."


def pynum(v):
    return repr(round(float(v), 4))


def _rgba(hex_color, alpha=1.0):
    h = hex_color.lstrip("#")
    return [round(int(h[i:i + 2], 16) / 255.0, 3) for i in (0, 2, 4)] + [alpha]


class Script:
    """Collects the lines of the emitted program, one module section at a time."""

    def __init__(self):
        self.lines = []
        self.wires = []

    def emit(self, line=""):
        self.lines.append(line)

    def place(self, var, text, x, y):
        self.emit('%s = place("%s", %d, %d)' % (var, text, x, y))
        return var

    def wire(self, src, dst):
        self.wires.append((src, dst))

    def flush(self):
        """Write the section's cords as one connect() call."""
        if not self.wires:
            return
        self.emit("patch.connect(")
        for src, dst in self.wires:
            self.emit("    [%s, %s]," % (src, dst))
        self.emit("    verbose=False,")
        self.emit(")")
        self.wires = []

    def text(self):
        return "\\n".join(self.lines) + "\\n"


class Device:
    """The emitter's state while it walks the chain: where things go, in both views."""

    def __init__(self, settings):
        self.s = Script()
        self.settings = settings
        self.y = 30
        self.math_rows = 0
        self.card_x = BRAND_W + CARD_GAP
        self.park_y = 30

    # presentation -----------------------------------------------------------------

    def open_card(self, mod):
        """Reserve the next card in the device view; returns the x of its first dial."""
        n = len(mod["params"])
        w = CARD_PAD * 2 + n * DIAL_STEP - (DIAL_STEP - DIAL_W)
        w = max(w, 2 * CARD_PAD + 60)
        x = self.card_x
        self.s.emit("card((%d, %d), x=%d, w=%d, color=CARD)" % (XP, self.park_y, x, w))
        self.s.emit('label("%s", (%d, %d), (%d, %d, %d, 18), size=10.0, bold=True, color=ACCENT)'
                    % (mod["label"].upper(), XP + 60, self.park_y, x, TITLE_Y, w))
        self.park_y += 30
        self.card_x = x + w + CARD_GAP
        inner = n * DIAL_STEP - (DIAL_STEP - DIAL_W)
        return x + (w - inner) // 2

    def dial(self, mod, param, index, first_x, value):
        var = "%s_%s" % (mod["id"], param["id"])
        self.s.emit(
            '%s = dial("%s %s", "%s", at=(%d, %d), slot=(%d, %d), lo=%s, hi=%s, init=%s, unit=%s, exponent=%s)'
            % (var, mod["label"], param["label"], param.get("short", param["label"]),
               XC + index * DX, self.y + ROW, first_x + index * DIAL_STEP, DIAL_Y,
               pynum(param["min"]), pynum(param["max"]), pynum(value),
               UNITSTYLE[param["unit"]], pynum(param.get("exponent", 1.0))))
        return var

    def dials(self, mod, values, math_rows=0):
        """
        Open a module's section: its dials on top, \`math_rows\` rows of control math under
        them, and the signal objects under those, so every cord in the section runs
        downward. ctl(k) and sig(k) give the y of the k-th row of each band.
        """
        self.math_rows = math_rows
        first_x = self.open_card(mod)
        return {p["id"]: self.dial(mod, p, i, first_x, values[p["id"]]) for i, p in enumerate(mod["params"])}

    def ctl(self, k):
        return self.y + ROW + DIAL_ROW + k * ROW

    def sig(self, k):
        return self.ctl(self.math_rows) + k * ROW

    def end(self, sig_rows):
        """Height of the section just emitted, given how many signal rows it used."""
        return self.sig(sig_rows) - self.y + GAP

    def header(self, title):
        self.s.emit()
        self.s.emit("# ── %s %s" % (title, "─" * max(4, 72 - len(title))))
        self.s.emit('note("=== %s ===", %d, %d)' % (title.upper(), X["L"], self.y))

    # shared sub-circuits ------------------------------------------------------------

    def mix(self, prefix, mix_dial, mix_value, dry, wet, row, ctl_row=0):
        """
        Dry/wet crossfade for both channels: out = dry * (1 - mix) + wet * mix.
        \`dry\` and \`wet\` map a channel to the outlet expression carrying it. \`row\` is the
        signal row the crossfade starts on; \`ctl_row\` the control row its math starts on.
        Returns the outgoing signal and the number of signal rows used so far.
        """
        s = self.s
        m = mix_value / 100.0
        y = self.sig(row)
        s.place(prefix + "_wet", "* 0.01", XC + 2 * DX, self.ctl(ctl_row))
        s.place(prefix + "_dry", "!- 1.", XC + 2 * DX, self.ctl(ctl_row + 1))
        s.wire("%s.outs[0]" % mix_dial, "%s_wet.ins[0]" % prefix)
        s.wire("%s_wet.outs[0]" % prefix, "%s_dry.ins[0]" % prefix)
        out = {}
        for ch in ("L", "R"):
            d, w, a = "%s_dry%s" % (prefix, ch), "%s_wet%s" % (prefix, ch), "%s_out%s" % (prefix, ch)
            s.place(d, "*~ %s" % fnum(1 - m), X[ch], y)
            s.place(w, "*~ %s" % fnum(m), X[ch] + SUB, y)
            s.place(a, "+~", X[ch], y + ROW)
            s.wire(dry[ch], "%s.ins[0]" % d)
            s.wire(wet[ch], "%s.ins[0]" % w)
            s.wire("%s_dry.outs[0]" % prefix, "%s.ins[1]" % d)
            s.wire("%s_wet.outs[0]" % prefix, "%s.ins[1]" % w)
            s.wire("%s.outs[0]" % d, "%s.ins[0]" % a)
            s.wire("%s.outs[0]" % w, "%s.ins[1]" % a)
            out[ch] = "%s.outs[0]" % a
        return out, row + 2


# Each module takes the device, the incoming signal per channel, its options and values,
# and returns the outgoing signal per channel plus how many rows it used.

def m_filter(dev, src, opt, val):
    s = dev.s
    d = dev.dials(_module("filter"), val)
    outlet = {"lowpass": 0, "highpass": 1, "bandpass": 2, "notch": 3}[opt["mode"]]
    out = {}
    for ch in ("L", "R"):
        v = s.place("filter_" + ch, "svf~ %s %s" % (fnum(val["cutoff"]), fnum(val["res"])), X[ch], dev.sig(0))
        s.wire(src[ch], v + ".ins[0]")
        s.wire(d["cutoff"] + ".outs[0]", v + ".ins[1]")
        s.wire(d["res"] + ".outs[0]", v + ".ins[2]")
        out[ch] = "%s.outs[%d]" % (v, outlet)  # svf~ outlets: lowpass, highpass, bandpass, notch
    return out, 1


def m_drive(dev, src, opt, val):
    s = dev.s
    d = dev.dials(_module("drive"), val)
    out = {}
    for ch in ("L", "R"):
        if opt["character"] == "soft":
            g = s.place("drive_" + ch, "overdrive~ %s" % fnum(val["amount"]), X[ch], dev.sig(0))
            s.wire(src[ch], g + ".ins[0]")
            s.wire(d["amount"] + ".outs[0]", g + ".ins[1]")
            shaped = g + ".outs[0]"
        else:
            g = s.place("drive_" + ch, "*~ %s" % fnum(val["amount"]), X[ch], dev.sig(0))
            c = s.place("drive_clip" + ch, "clip~ -1. 1.", X[ch], dev.sig(1))
            s.wire(src[ch], g + ".ins[0]")
            s.wire(d["amount"] + ".outs[0]", g + ".ins[1]")
            s.wire(g + ".outs[0]", c + ".ins[0]")
            shaped = c + ".outs[0]"
        t = s.place("drive_tone" + ch, "onepole~ %s" % fnum(val["tone"]), X[ch], dev.sig(2))
        s.wire(shaped, t + ".ins[0]")
        s.wire(d["tone"] + ".outs[0]", t + ".ins[1]")
        out[ch] = t + ".outs[0]"
    return out, 3


def m_crush(dev, src, opt, val):
    s = dev.s
    d = dev.dials(_module("crush"), val, math_rows=1)
    s.place("crush_ratio", "* 0.01", XC, dev.ctl(0))
    s.wire(d["rate"] + ".outs[0]", "crush_ratio.ins[0]")
    out = {}
    for ch in ("L", "R"):
        v = s.place("crush_" + ch, "degrade~ %s %d" % (fnum(val["rate"] / 100.0), int(val["bits"])), X[ch], dev.sig(0))
        s.wire(src[ch], v + ".ins[0]")
        s.wire("crush_ratio.outs[0]", v + ".ins[1]")
        s.wire(d["bits"] + ".outs[0]", v + ".ins[2]")
        out[ch] = v + ".outs[0]"
    return out, 1


def m_chorus(dev, src, opt, val):
    s = dev.s
    d = dev.dials(_module("chorus"), val, math_rows=3)
    s.place("chorus_lfo", "cycle~ %s" % fnum(val["rate"]), XC, dev.ctl(0))
    s.place("chorus_depth_sig", "*~ %s" % fnum(val["depth"]), XC, dev.ctl(1))
    s.place("chorus_invert", "*~ -1.", XC, dev.ctl(2))
    s.wire(d["rate"] + ".outs[0]", "chorus_lfo.ins[0]")
    s.wire("chorus_lfo.outs[0]", "chorus_depth_sig.ins[0]")
    s.wire(d["depth"] + ".outs[0]", "chorus_depth_sig.ins[1]")
    s.wire("chorus_depth_sig.outs[0]", "chorus_invert.ins[0]")
    sweep = {"L": "chorus_depth_sig.outs[0]", "R": "chorus_invert.outs[0]"}
    wet = {}
    for ch in ("L", "R"):
        # The delay time, in ms, as a signal: 12 ms plus or minus the sweep.
        t = s.place("chorus_time" + ch, "+~ 12.", X[ch] + SUB, dev.sig(0))
        i = s.place("chorus_in" + ch, "tapin~ 100", X[ch], dev.sig(0))
        o = s.place("chorus_tap" + ch, "tapout~", X[ch], dev.sig(1))
        s.wire(sweep[ch], t + ".ins[0]")
        s.wire(src[ch], i + ".ins[0]")
        s.wire(i + ".outs[0]", o + ".ins[0]")
        s.wire(t + ".outs[0]", o + ".ins[0]")
        wet[ch] = o + ".outs[0]"
    return dev.mix("chorus", d["mix"], val["mix"], src, wet, 2)


def m_tremolo(dev, src, opt, val):
    s = dev.s
    d = dev.dials(_module("tremolo"), val, math_rows=2)
    half = val["depth"] / 200.0
    # gain = (1 - depth/2) + (depth/2) * sin, so full depth swings between 0 and 1.
    s.place("tremolo_lfo", "cycle~ %s" % fnum(val["rate"]), XC, dev.ctl(0))
    s.place("tremolo_half", "* 0.005", XC + DX, dev.ctl(0))
    s.place("tremolo_base", "!- 1.", XC + DX, dev.ctl(1))
    s.wire(d["rate"] + ".outs[0]", "tremolo_lfo.ins[0]")
    s.wire(d["depth"] + ".outs[0]", "tremolo_half.ins[0]")
    s.wire("tremolo_half.outs[0]", "tremolo_base.ins[0]")
    lfo = {"L": "tremolo_lfo.outs[0]", "R": "tremolo_lfo.outs[0]"}
    if opt["mode"] == "autopan":
        s.place("tremolo_invert", "*~ -1.", XC, dev.ctl(1))
        s.wire("tremolo_lfo.outs[0]", "tremolo_invert.ins[0]")
        lfo["R"] = "tremolo_invert.outs[0]"
    out = {}
    for ch in ("L", "R"):
        a = s.place("tremolo_swing" + ch, "*~ %s" % fnum(half), X[ch] + SUB, dev.sig(0))
        m = s.place("tremolo_gain" + ch, "+~ %s" % fnum(1 - half), X[ch] + SUB, dev.sig(1))
        v = s.place("tremolo_" + ch, "*~ 0.", X[ch], dev.sig(2))
        s.wire(lfo[ch], a + ".ins[0]")
        s.wire("tremolo_half.outs[0]", a + ".ins[1]")
        s.wire(a + ".outs[0]", m + ".ins[0]")
        s.wire("tremolo_base.outs[0]", m + ".ins[1]")
        s.wire(src[ch], v + ".ins[0]")
        s.wire(m + ".outs[0]", v + ".ins[1]")
        out[ch] = v + ".outs[0]"
    return out, 3


def m_delay(dev, src, opt, val):
    s = dev.s
    d = dev.dials(_module("delay"), val, math_rows=2)
    s.place("delay_fb", "* 0.01", XC + DX, dev.ctl(0))
    s.wire(d["feedback"] + ".outs[0]", "delay_fb.ins[0]")
    wet = {}
    for ch in ("L", "R"):
        i = s.place("delay_in" + ch, "tapin~ 2000", X[ch], dev.sig(0))
        o = s.place("delay_tap" + ch, "tapout~ %s" % fnum(val["time"]), X[ch], dev.sig(1))
        f = s.place("delay_fb" + ch, "*~ %s" % fnum(val["feedback"] / 100.0), X[ch] + SUB, dev.sig(2))
        s.wire(i + ".outs[0]", o + ".ins[0]")
        s.wire(d["time"] + ".outs[0]", o + ".ins[0]")
        s.wire(o + ".outs[0]", f + ".ins[0]")
        s.wire("delay_fb.outs[0]", f + ".ins[1]")
        wet[ch] = o + ".outs[0]"
    if opt["style"] == "pingpong":
        # Both inputs enter on the left; each side's echo feeds the other side's line.
        s.wire(src["L"], "delay_inL.ins[0]")
        s.wire(src["R"], "delay_inL.ins[0]")
        s.wire("delay_fbL.outs[0]", "delay_inR.ins[0]")
        s.wire("delay_fbR.outs[0]", "delay_inL.ins[0]")
    else:
        for ch in ("L", "R"):
            s.wire(src[ch], "delay_in%s.ins[0]" % ch)
            s.wire("delay_fb%s.outs[0]" % ch, "delay_in%s.ins[0]" % ch)
    return dev.mix("delay", d["mix"], val["mix"], src, wet, 3)


# Comb delay times in ms. The right channel's are slightly longer, which is what makes
# the tail wide instead of a mono reverb in both speakers.
COMBS = {"L": (29.7, 37.1, 41.1, 43.7), "R": (30.3, 37.9, 41.9, 44.5)}
ALLPASS = {"L": (5.0, 1.7), "R": (5.3, 1.9)}


def m_reverb(dev, src, opt, val):
    s = dev.s
    d = dev.dials(_module("reverb"), val, math_rows=2)
    fb = 0.7 + 0.28 * val["size"] / 100.0
    s.place("reverb_fb", "scale 0. 100. 0.7 0.98", XC, dev.ctl(0))
    s.wire(d["size"] + ".outs[0]", "reverb_fb.ins[0]")
    wet = {}
    for ch in ("L", "R"):
        total = s.place("reverb_sum" + ch, "*~ 0.25", X[ch], dev.sig(4))
        for n, ms in enumerate(COMBS[ch]):
            c = s.place("reverb_comb%s%d" % (ch, n + 1), "comb~ 60 %s 0. 1. %s" % (fnum(ms), fnum(fb)), X[ch], dev.sig(n))
            s.wire(src[ch], c + ".ins[0]")
            s.wire("reverb_fb.outs[0]", c + ".ins[4]")
            s.wire(c + ".outs[0]", total + ".ins[0]")
        a1 = s.place("reverb_apA" + ch, "allpass~ 20 %s 0.5" % fnum(ALLPASS[ch][0]), X[ch], dev.sig(5))
        a2 = s.place("reverb_apB" + ch, "allpass~ 20 %s 0.5" % fnum(ALLPASS[ch][1]), X[ch], dev.sig(6))
        dm = s.place("reverb_damp" + ch, "onepole~ %s" % fnum(val["damp"]), X[ch], dev.sig(7))
        s.wire(total + ".outs[0]", a1 + ".ins[0]")
        s.wire(a1 + ".outs[0]", a2 + ".ins[0]")
        s.wire(a2 + ".outs[0]", dm + ".ins[0]")
        s.wire(d["damp"] + ".outs[0]", dm + ".ins[1]")
        wet[ch] = dm + ".outs[0]"
    return dev.mix("reverb", d["mix"], val["mix"], src, wet, 8)


MODULES = {
    "filter": m_filter,
    "drive": m_drive,
    "crush": m_crush,
    "chorus": m_chorus,
    "tremolo": m_tremolo,
    "delay": m_delay,
    "reverb": m_reverb,
}


def script(settings):
    """The maxpylang program that builds the device these settings describe."""
    st = normalize(settings)
    sch = schema()
    dev = Device(st)
    s = dev.s
    active = [e for e in st["chain"] if e["on"]]

    s.emit('"""')
    s.emit("%s: a Max for Live audio effect, generated with MaxPyLang." % st["name"])
    s.emit("")
    s.emit("Signal flow: plugin~ -> %s -> clip~ -> plugout~"
           % " -> ".join([_module(e["module"])["label"].lower() for e in active] + ["output gain"]))
    s.emit("Run it with \`pip install maxpylang\`; it writes %s next to this file." % filename(st))
    s.emit('"""')
    s.emit(PREAMBLE)
    s.emit()
    s.emit("ACCENT = %r" % _rgba(st["accent"]))
    s.emit("CARD = [0.11, 0.12, 0.14, 1.0]")
    s.emit("INK = [0.93, 0.94, 0.96, 1.0]")
    s.emit("DIM = [0.55, 0.58, 0.63, 1.0]")

    # input
    dev.header("input")
    s.place("plug_in", "plugin~", X["L"], dev.y + ROW)
    s.emit('label(%s, (%d, %d), (8, 62, %d), size=12.0, bold=True, color=INK)' % (json.dumps(st["name"]), XP, dev.park_y, BRAND_W - 8))
    s.emit('label("MaxPyLang", (%d, %d), (8, 82, %d), size=9.0, color=DIM)' % (XP + 60, dev.park_y, BRAND_W - 8))
    dev.park_y += 30
    sig = {"L": "plug_in.outs[0]", "R": "plug_in.outs[1]"}
    dev.y += 2 * ROW + GAP

    for entry in active:
        mod = _module(entry["module"])
        dev.header(mod["label"])
        sig, rows = MODULES[mod["id"]](dev, sig, entry["options"], entry["values"])
        s.flush()
        dev.y += dev.end(rows)

    # output: gain in dB, a safety clip, and out to Live's mixer
    out = sch["output"]
    dev.header("output")
    d = dev.dials(out, st["output"], math_rows=1)
    s.place("output_amp", "dbtoa", XC, dev.ctl(0))
    s.wire(d["gain"] + ".outs[0]", "output_amp.ins[0]")
    amp = 10 ** (st["output"]["gain"] / 20.0)
    for ch in ("L", "R"):
        s.place("output_" + ch, "*~ %s" % fnum(amp), X[ch], dev.sig(0))
        s.place("output_clip" + ch, "clip~ -1. 1.", X[ch], dev.sig(1))
    s.place("plug_out", "plugout~", X["L"], dev.sig(2))
    for i, ch in enumerate(("L", "R")):
        g, c = "output_" + ch, "output_clip" + ch
        s.wire(sig[ch], g + ".ins[0]")
        s.wire("output_amp.outs[0]", g + ".ins[1]")
        s.wire(g + ".outs[0]", c + ".ins[0]")
        s.wire(c + ".outs[0]", "plug_out.ins[%d]" % i)
    s.flush()

    width = dev.card_x
    s.emit()
    s.emit("# ── device " + "─" * 66)
    s.emit("# Open in presentation mode, at the width the cards add up to. (gap M4L-04)")
    s.emit('patcher = patch._patcher_dict["patcher"]')
    s.emit('patcher["openinpresentation"] = 1')
    s.emit('patcher["devicewidth"] = %s' % pynum(width))
    s.emit()
    s.emit('patch.save(%s, device_type="audio_effect", verbose=False)' % json.dumps(filename(st)))
    return s.text()


# ── running it ──────────────────────────────────────────────────────────────────

def run(settings, want_amxd=True):
    """
    Execute script(settings) and report what it produced.

    Returns a dict: the script, the patcher JSON, the .amxd bytes (base64) when asked for,
    everything maxpylang printed or warned while building and checking the patch, and the
    type checks' coverage numbers. The page shows the last two as its "type check" panel,
    which is where a gap in what maxpylang can judge first becomes visible.
    """
    import maxpylang as mp

    st = normalize(settings)
    src = script(st)
    out = io.StringIO()
    ns = {"__name__": "__fxgen__"}
    cwd = os.getcwd()
    result = {"settings": st, "script": src, "filename": filename(st)}
    with tempfile.TemporaryDirectory() as tmp:
        os.chdir(tmp)
        try:
            with warnings.catch_warnings(record=True) as caught, contextlib.redirect_stdout(out):
                warnings.simplefilter("always")
                exec(compile(src, "<%s>" % filename(st), "exec"), ns)
            path = os.path.join(tmp, filename(st))
            if want_amxd:
                with open(path, "rb") as fh:
                    result["amxd"] = base64.b64encode(fh.read()).decode("ascii")
        finally:
            os.chdir(cwd)

    patch = ns["patch"]
    assert isinstance(patch, mp.MaxPatch)
    result["json"] = patch.get_json()
    result["log"] = out.getvalue()
    result["warnings"] = [{"category": w.category.__name__, "message": str(w.message)} for w in caught]
    try:
        result["coverage"] = json.loads(json.dumps(patch.get_coverage(), default=str))
    except Exception as err:  # the page still works without the numbers
        result["coverage"] = {"error": str(err)}
    return result


def run_json(settings_json, want_amxd=True):
    """run(), with JSON text in and out. The entry point the Pyodide worker calls."""
    return json.dumps(run(json.loads(settings_json), want_amxd))
`,tt=`{
  "version": 1,
  "modules": [
    {
      "id": "filter",
      "label": "Filter",
      "blurb": "State-variable filter. Sweep it, or park it to shape the tone.",
      "options": [
        {
          "id": "mode",
          "label": "Type",
          "default": "lowpass",
          "choices": [
            { "id": "lowpass", "label": "Low-pass" },
            { "id": "highpass", "label": "High-pass" },
            { "id": "bandpass", "label": "Band-pass" },
            { "id": "notch", "label": "Notch" }
          ]
        }
      ],
      "params": [
        { "id": "cutoff", "label": "Cutoff", "min": 40, "max": 18000, "default": 1800, "unit": "Hz", "exponent": 3.0 },
        { "id": "res", "label": "Reso", "min": 0, "max": 0.95, "default": 0.35, "unit": "", "exponent": 1.0 }
      ]
    },
    {
      "id": "drive",
      "label": "Drive",
      "blurb": "Saturation, from a warm push to a hard clip, with a tone control after it.",
      "options": [
        {
          "id": "character",
          "label": "Character",
          "default": "soft",
          "choices": [
            { "id": "soft", "label": "Soft (overdrive~)" },
            { "id": "hard", "label": "Hard (clip~)" }
          ]
        }
      ],
      "params": [
        { "id": "amount", "label": "Drive", "min": 1, "max": 12, "default": 3, "unit": "x", "exponent": 1.5 },
        { "id": "tone", "label": "Tone", "min": 400, "max": 18000, "default": 9000, "unit": "Hz", "exponent": 3.0 }
      ]
    },
    {
      "id": "crush",
      "label": "Crush",
      "blurb": "Bit depth and sample rate reduction with degrade~. Lo-fi on demand.",
      "options": [],
      "params": [
        { "id": "rate", "label": "Rate", "min": 2, "max": 100, "default": 35, "unit": "%", "exponent": 2.0 },
        { "id": "bits", "label": "Bits", "min": 2, "max": 16, "default": 8, "unit": "bit", "exponent": 1.0, "integer": true }
      ]
    },
    {
      "id": "chorus",
      "label": "Chorus",
      "blurb": "A modulated delay line per channel, moving in opposite directions for width.",
      "options": [],
      "params": [
        { "id": "rate", "label": "Rate", "min": 0.05, "max": 8, "default": 0.6, "unit": "Hz", "exponent": 2.0 },
        { "id": "depth", "label": "Depth", "min": 0, "max": 8, "default": 3, "unit": "ms", "exponent": 1.0 },
        { "id": "mix", "label": "Mix", "min": 0, "max": 100, "default": 50, "unit": "%", "exponent": 1.0 }
      ]
    },
    {
      "id": "tremolo",
      "label": "Tremolo",
      "blurb": "An LFO on the volume. Switch to auto-pan to move it between the speakers.",
      "options": [
        {
          "id": "mode",
          "label": "Mode",
          "default": "tremolo",
          "choices": [
            { "id": "tremolo", "label": "Tremolo" },
            { "id": "autopan", "label": "Auto-pan" }
          ]
        }
      ],
      "params": [
        { "id": "rate", "label": "Rate", "min": 0.1, "max": 20, "default": 5, "unit": "Hz", "exponent": 2.0 },
        { "id": "depth", "label": "Depth", "min": 0, "max": 100, "default": 60, "unit": "%", "exponent": 1.0 }
      ]
    },
    {
      "id": "delay",
      "label": "Delay",
      "blurb": "Feedback delay on a tapin~ / tapout~ pair. Ping-pong bounces it left and right.",
      "options": [
        {
          "id": "style",
          "label": "Style",
          "default": "stereo",
          "choices": [
            { "id": "stereo", "label": "Stereo" },
            { "id": "pingpong", "label": "Ping-pong" }
          ]
        }
      ],
      "params": [
        { "id": "time", "label": "Time", "min": 10, "max": 1500, "default": 320, "unit": "ms", "exponent": 2.0 },
        { "id": "feedback", "label": "Feedback", "short": "Fdbk", "min": 0, "max": 95, "default": 40, "unit": "%", "exponent": 1.0 },
        { "id": "mix", "label": "Mix", "min": 0, "max": 100, "default": 30, "unit": "%", "exponent": 1.0 }
      ]
    },
    {
      "id": "reverb",
      "label": "Reverb",
      "blurb": "A Schroeder reverb: four comb~ filters into two allpass~ stages per channel.",
      "options": [],
      "params": [
        { "id": "size", "label": "Size", "min": 0, "max": 100, "default": 55, "unit": "%", "exponent": 1.0 },
        { "id": "damp", "label": "Damp", "min": 500, "max": 16000, "default": 6000, "unit": "Hz", "exponent": 3.0 },
        { "id": "mix", "label": "Mix", "min": 0, "max": 100, "default": 25, "unit": "%", "exponent": 1.0 }
      ]
    }
  ],
  "output": {
    "id": "output",
    "label": "Output",
    "params": [
      { "id": "gain", "label": "Gain", "min": -24, "max": 12, "default": 0, "unit": "dB", "exponent": 1.0 }
    ]
  },
  "accents": ["#ff7a45", "#f5c542", "#4bd08a", "#38bdf8", "#a78bfa", "#f472b6"]
}
`,nt="https://cdn.jsdelivr.net/pyodide/v314.0.3/full/",st="py/maxpylang-0.1.1-py3-none-any.whl";class at{constructor(t){this.pending=new Map,this.nextId=1,this.worker=new Worker(new URL("/MaxPyLang/app/assets/pyodide-worker-D1g7dbRn.js",import.meta.url),{type:"module"});let n,s;const o=new Promise((l,a)=>{n=l,s=a});this.worker.onmessage=l=>{const a=l.data;if(a.type==="status")return t(a.message??"");if(a.type==="ready")return n();if(a.type==="error"&&a.phase==="init")return s(new Error(a.message));const d=a.id!==void 0?this.pending.get(a.id):void 0;!d||a.id===void 0||(this.pending.delete(a.id),a.type==="result"?d.resolve(a.json??""):d.reject(new Error(a.message??"Python error")))},this.worker.onerror=l=>s(new Error(l.message||"the Python worker failed to start"));const c=new URL("/MaxPyLang/app/"+st,location.href).href;this.worker.postMessage({type:"init",pyodideCdn:nt,wheelUrl:c}),this.ready=o.then(async()=>{t("loading the generator…"),await this.send({type:"install",dir:"/fxgen",files:{"fxgen.py":et,"schema.json":tt}})}),this.ready.catch(()=>{})}send(t){const n=this.nextId++;return new Promise((s,o)=>{this.pending.set(n,{resolve:s,reject:o}),this.worker.postMessage({...t,id:n})})}async run(t,n=!1){await this.ready;const s=await this.send({type:"call",module:"fxgen",fn:"run_json",args:[JSON.stringify(t),n]});return JSON.parse(s)}}function ot(e){const t=atob(e),n=new Uint8Array(new ArrayBuffer(t.length));for(let s=0;s<t.length;s++)n[s]=t.charCodeAt(s);return n}const r=e=>document.getElementById(e),_e=["piano","guitar","vocals","drums"].map(e=>({id:e,label:e[0].toUpperCase()+e.slice(1),url:`/MaxPyLang/app/samples/fx/${e}.mp3`})),it={"M4L-01":"A dial’s range, unit and start value cannot be set through edit()","M4L-02":"Presentation mode has no API, and edit() rejects it on some objects","M4L-03":"A comment’s text is saved with the object name in front of it","M4L-04":"Patcher settings (open in presentation, device width) have no API"},rt="https://github.com/Barnard-PL-Labs/MaxPyLang/blob/main/docs/type-system/m4l-gaps.md";let R,y,A=0,Le="device",$="piano",E,W=[],B=0,f=dt();const k=new $e,g=new Be(k.ctx),lt=Oe(k.ctx),ct=Ze(),O=new at(e=>P("loading",ut(e.replace(/…$/,""))));function dt(){var s;const e=(s=location.hash.match(/^#s=(.+)$/))==null?void 0:s[1],t=e?Qe(e):void 0;if(t)return t;const n=we[0];return R=n.id,n.sample&&($=n.sample),F(n.settings)}const ut=e=>e&&e[0].toUpperCase()+e.slice(1);function P(e,t){r("status").dataset.state=e,r("status-text").textContent=t,e==="loading"&&(r("boot-text").textContent=t)}let de=0;function C(e){const t=r("toast");t.textContent=e,t.classList.add("show"),clearTimeout(de),de=window.setTimeout(()=>t.classList.remove("show"),2600)}let ue=0;function L(e=0){clearTimeout(ue),clearTimeout(q),ue=window.setTimeout(()=>void pt(),e),Se()}async function pt(){const e=++A;try{if(await O.ready,e!==A)return;P("building","Building");const t=await O.run(f,!1);if(e!==A)return;await lt,await mt(t),P("ready","Python ready")}catch(t){if(e!==A)return;console.error(t),P("error","Build failed"),K(String(t.message||t))}}async function mt(e){var o;y=e;const t=je(e.json);for(const c of W)c();W=[];const n=await g.duck(()=>k.build(t));for(const c of t.nodes){if(c.maxclass!=="live.dial")continue;const l=ct.get(String(((o=c.raw)==null?void 0:o.varname)??"")),a=n.built.get(c.id);if(!l||!(a!=null&&a.onControlOut))continue;const d=a.onControlOut(0,p=>{const i=Xe(p);i!==void 0&&ht(l.module,l.param,i)});typeof d=="function"&&W.push(d)}B=Fe(r("device"),e.json,n.built);const s=He(r("patch-wrap"),t);r("patch-wrap").dataset.hidden=String(s),Q(),r("boot").hidden=!0,r("btn-download").disabled=!1,gt(e),Z(e),V()}let q=0;function ht(e,t,n){var o;const s=e===w.output.id?f.output:(o=f.chain.find(c=>c.module===e))==null?void 0:o.values;!s||Math.abs((s[t]??NaN)-n)<1e-9||(s[t]=n,T(),Se(),clearTimeout(q),q=window.setTimeout(()=>void ft(),450))}async function ft(){const e=A;try{const t=await O.run(f,!1);if(e!==A)return;y=t,Z(t)}catch(t){console.error(t)}}let pe=0;function Se(){clearTimeout(pe),pe=window.setTimeout(()=>{history.replaceState(null,"",`#s=${ye(f)}`)},300)}function V(){r("device-title").textContent=f.name;const e=f.chain.filter(n=>n.on).map(n=>{var s;return((s=J(n.module))==null?void 0:s.label)??n.module}),t=r("device-flow");t.replaceChildren();for(const[n,s]of["plugin~",...e,"Output","plugout~"].entries())n&&t.append(Object.assign(document.createElement("i"),{textContent:"→"})),t.append(Object.assign(document.createElement("span"),{textContent:s,className:s.endsWith("~")?"io":""}))}function N(e,t,n=""){const s=document.createElement("div");return s.className=`stat ${n}`,s.append(Object.assign(document.createElement("b"),{textContent:String(e)}),Object.assign(document.createElement("span"),{textContent:t})),s}function gt(e){const t=r("check");t.replaceChildren();const n=e.coverage.cords,s=e.coverage.objects,o=document.createElement("div");o.className="stats",n&&s&&o.append(N(s.total,"objects"),N(n.total,"cords"),N(n.checked,"cords checked",n.checked===n.total?"good":""),N(n.flagged,"flagged",n.flagged?"bad":"good"),N(n.not_checked,"not checked",n.not_checked?"warn":"good")),t.append(o);const c=[];for(const a of e.warnings)c.push(`${a.category}: ${a.message}`);for(const a of(n==null?void 0:n.not_checked_because)??[])c.push(`not checked: ${JSON.stringify(a)}`);for(const a of(s==null?void 0:s.not_seen_into)??[])c.push(`cannot see into: ${a}`);if(c.length){const a=document.createElement("ul");a.className="check-lines";for(const d of c)a.append(Object.assign(document.createElement("li"),{textContent:d}));t.append(a)}const l=[...new Set([...e.script.matchAll(/gap (M4L-\d+)/g)].map(a=>a[1]))].sort();if(l.length){const a=document.createElement("div");a.className="gaps";const d=document.createElement("p");d.innerHTML=`<b>${l.length} things this device needs that MaxPyLang cannot say yet.</b> The script works around each one, and each is in the <a href="${rt}" target="_blank" rel="noopener">gap log</a>.`;const p=document.createElement("ul");for(const i of l){const m=document.createElement("li");m.append(Object.assign(document.createElement("code"),{textContent:i}),` ${it[i]??""}`),p.append(m)}a.append(d,p),t.append(a)}}function K(e){const t=r("check");t.replaceChildren();const n=document.createElement("pre");n.className="check-error",n.textContent=e,t.append(Object.assign(document.createElement("p"),{textContent:"Python raised an error while building this device:",className:"bad"}),n)}function Z(e){r("code").innerHTML=Ue(e.script);const t=e.script.split(`
`).length;r("py-meta").textContent=`${t} lines · writes ${e.filename}`}function Q(){if(!B)return;const t=r("device-wrap").clientWidth-48,n=Math.max(.62,Math.min(1.6,t/B)),s=r("device");s.style.transform=`scale(${n})`;const o=s.parentElement;o.style.setProperty("--dw",`${B*n}px`),o.style.setProperty("--dh",`${ve*n}px`)}function U(e){Le=e,r("stage").dataset.view=e,r("view-device").setAttribute("aria-selected",String(e==="device")),r("view-patch").setAttribute("aria-selected",String(e==="patch")),r("device-wrap").hidden=e!=="device",r("patch-wrap").hidden=e!=="patch",e==="device"&&Q()}function T(){if(R){R=void 0;for(const e of document.querySelectorAll(".preset.is-active"))e.classList.remove("is-active")}}function bt(){const e=r("presets");e.replaceChildren();const t=new Map;for(const n of we)t.set(n.group,[...t.get(n.group)??[],n]);for(const[n,s]of t){e.append(Object.assign(document.createElement("h3"),{textContent:n}));const o=document.createElement("div");o.className="preset-grid";for(const c of s){const l=document.createElement("button");l.type="button",l.className=`preset${c.id===R?" is-active":""}`,l.style.setProperty("--dot",c.settings.accent??w.accents[0]),l.title=c.tag,l.append(Object.assign(document.createElement("b"),{textContent:c.name}),Object.assign(document.createElement("span"),{textContent:c.tag})),l.addEventListener("click",()=>vt(c)),o.append(l)}e.append(o)}}function vt(e){f=F(e.settings),R=e.id,e.sample&&!E&&te(e.sample),ke(),L()}function Ae(){const e=r("accents");e.replaceChildren();for(const t of w.accents){const n=document.createElement("button");n.type="button",n.className="accent",n.style.background=t,n.setAttribute("role","radio"),n.setAttribute("aria-checked",String(t===f.accent)),n.setAttribute("aria-label",t),n.addEventListener("click",()=>{f.accent=t,T(),Ee(),Ae(),L()}),e.append(n)}}function Ee(){document.documentElement.style.setProperty("--accent",f.accent)}let x;function z(){const e=r("chain");e.replaceChildren(),f.chain.forEach((t,n)=>e.append(wt(t,n)))}function wt(e,t){const n=J(e.module),s=document.createElement("li");s.className=`mod${e.on?" is-on":""}`,s.dataset.id=e.module,s.draggable=!0;const o=document.createElement("div");o.className="mod-row";const c=document.createElement("span");c.className="grip",c.title="Drag to reorder",c.innerHTML='<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="3" cy="4" r="1.1"/><circle cx="7" cy="4" r="1.1"/><circle cx="3" cy="8" r="1.1"/><circle cx="7" cy="8" r="1.1"/><circle cx="3" cy="12" r="1.1"/><circle cx="7" cy="12" r="1.1"/></g></svg>';const l=document.createElement("div");l.className="mod-name",l.append(Object.assign(document.createElement("b"),{textContent:n.label}),Object.assign(document.createElement("span"),{textContent:n.params.map(p=>p.label).join(" · ")}));const a=document.createElement("div");a.className="mod-move";for(const[p,i,m]of[[-1,"M3 9l4-4 4 4","Move up"],[1,"M3 5l4 4 4-4","Move down"]]){const u=document.createElement("button");u.type="button",u.title=`${m}: ${n.label}`,u.setAttribute("aria-label",`${m}: ${n.label}`),u.disabled=t+p<0||t+p>=f.chain.length,u.innerHTML=`<svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><path d="${i}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,u.addEventListener("click",()=>me(e.module,t+p)),a.append(u)}const d=document.createElement("button");if(d.type="button",d.className="switch",d.setAttribute("role","switch"),d.setAttribute("aria-checked",String(e.on)),d.setAttribute("aria-label",`${n.label} on`),d.addEventListener("click",()=>{e.on=!e.on,T(),z(),L()}),o.append(c,l,a,d),s.append(o),e.on){const p=document.createElement("div");p.className="mod-body",n.blurb&&p.append(Object.assign(document.createElement("p"),{textContent:n.blurb}));for(const i of n.options){const m=document.createElement("div");m.className="seg",m.setAttribute("role","radiogroup"),m.setAttribute("aria-label",`${n.label} ${i.label}`);for(const u of i.choices){const h=document.createElement("button");h.type="button",h.textContent=u.label,h.setAttribute("role","radio"),h.setAttribute("aria-checked",String(e.options[i.id]===u.id)),h.addEventListener("click",()=>{e.options[i.id]!==u.id&&(e.options[i.id]=u.id,T(),z(),L())}),m.append(h)}p.append(m)}s.append(p)}return s.addEventListener("dragstart",p=>{var i;x=e.module,s.classList.add("is-dragging"),(i=p.dataTransfer)==null||i.setData("text/plain",e.module),p.dataTransfer&&(p.dataTransfer.effectAllowed="move")}),s.addEventListener("dragend",()=>{x=void 0;for(const p of document.querySelectorAll(".mod"))p.classList.remove("is-dragging","drop-before","drop-after")}),s.addEventListener("dragover",p=>{if(!x||x===e.module)return;p.preventDefault();const i=s.getBoundingClientRect(),m=p.clientY>i.top+i.height/2;s.classList.toggle("drop-before",!m),s.classList.toggle("drop-after",m)}),s.addEventListener("dragleave",()=>s.classList.remove("drop-before","drop-after")),s.addEventListener("drop",p=>{if(!x||x===e.module)return;p.preventDefault();const i=s.classList.contains("drop-after"),m=f.chain.findIndex(h=>h.module===x);let u=f.chain.findIndex(h=>h.module===e.module)+(i?1:0);m<u&&u--,me(x,u)}),s}function me(e,t){const n=f.chain.findIndex(o=>o.module===e);if(n<0||t<0||t>=f.chain.length||n===t)return;const[s]=f.chain.splice(n,1);f.chain.splice(t,0,s),T(),z(),L()}function he(e){for(const t of["presets","build"])r(`tab-${t}`).setAttribute("aria-selected",String(t===e)),r(`pane-${t}`).hidden=t!==e}function ke(){bt(),r("name").value=f.name,Ee(),Ae(),z(),V()}function ee(){var t;const e=r("samples");e.replaceChildren();for(const n of _e){const s=document.createElement("button");s.type="button",s.className="chip",s.textContent=n.label,s.setAttribute("role","radio"),s.setAttribute("aria-checked",String(!E&&n.id===$)),s.addEventListener("click",()=>{E=void 0,r("file-name").textContent="Your audio",te(n.id)}),e.append(s)}(t=document.querySelector(".chip.upload"))==null||t.classList.toggle("is-active",!!E)}async function te(e){$=e,ee();const t=_e.find(n=>n.id===e);if(t)try{const n=await g.load(t);$===e&&!E&&g.setBuffer(n)}catch(n){C(String(n.message||n))}}async function fe(e){try{const t=await g.decode(await e.arrayBuffer());E=t,r("file-name").textContent=e.name.length>22?`${e.name.slice(0,20)}…`:e.name,ee(),g.setBuffer(t),g.playing||await Y(!0)}catch{C("That file could not be decoded as audio.")}}async function Y(e){const t=r("btn-play");e?(await k.start(),g.play(),xt()):(g.stop(),await k.stop()),t.setAttribute("aria-pressed",String(e)),t.setAttribute("aria-label",e?"Stop":"Play"),document.body.classList.toggle("is-playing",e)}let G=!1;function xt(){if(G)return;G=!0;const e=r("scope"),t=e.getContext("2d"),n=new Uint8Array(new ArrayBuffer(g.analyser.frequencyBinCount)),s=r("meter-l"),o=r("meter-r"),c=matchMedia("(prefers-reduced-motion: reduce)").matches;let l=[0,0];const a=()=>{if(!g.playing){G=!1,t.clearRect(0,0,e.width,e.height),s.style.setProperty("--level","0"),o.style.setProperty("--level","0");return}requestAnimationFrame(a);const[d,p]=g.levels();l=[Math.max(d,l[0]*.9),Math.max(p,l[1]*.9)];const i=S=>String(Math.max(0,Math.min(1,1+20*Math.log10(S||1e-6)/48)));if(s.style.setProperty("--level",i(l[0])),o.style.setProperty("--level",i(l[1])),s.classList.toggle("clip",d>=.999),o.classList.toggle("clip",p>=.999),c||Le!=="device"){t.clearRect(0,0,e.width,e.height);return}const m=Math.min(2,devicePixelRatio||1),u=e.clientWidth,h=e.clientHeight;(e.width!==Math.round(u*m)||e.height!==Math.round(h*m))&&(e.width=Math.round(u*m),e.height=Math.round(h*m)),t.setTransform(m,0,0,m,0,0),t.clearRect(0,0,u,h),g.analyser.getByteFrequencyData(n);const M=k.ctx.sampleRate/2,b=Math.log(40),_=Math.log(16e3),D=96;t.beginPath(),t.moveTo(0,h);for(let S=0;S<=D;S++){const Te=Math.exp(b+(_-b)*S/D),Me=Math.min(n.length-1,Math.round(Te/M*n.length)),De=h-(n[Me]/255)**1.5*h*.92;t.lineTo(S/D*u,De)}t.lineTo(u,h),t.closePath();const I=t.createLinearGradient(0,0,0,h);I.addColorStop(0,`${f.accent}88`),I.addColorStop(1,`${f.accent}00`),t.fillStyle=I,t.fill()};requestAnimationFrame(a)}function Ce(e,t,n){const s=URL.createObjectURL(new Blob([e],{type:n})),o=Object.assign(document.createElement("a"),{href:s,download:t});document.body.append(o),o.click(),o.remove(),setTimeout(()=>URL.revokeObjectURL(s),2e3)}async function yt(){const e=r("btn-download");e.disabled=!0,e.classList.add("is-busy");try{const t=await O.run(f,!0);if(!t.amxd)throw new Error("the generator returned no device");Ce(ot(t.amxd),t.filename,"application/octet-stream"),y=t,Z(t),C(`Saved ${t.filename}. Drag it onto an audio track in Live.`)}catch(t){console.error(t),C("The download failed. See the type check panel."),K(String(t.message||t))}finally{e.disabled=!1,e.classList.remove("is-busy")}}function j(e){r("drawer").classList.toggle("open",e),r("drawer").setAttribute("aria-hidden",String(!e)),r("btn-python").setAttribute("aria-expanded",String(e)),r("scrim").hidden=!e,e?r("drawer-close").focus():r("btn-python").focus()}async function ge(e,t){try{await navigator.clipboard.writeText(e),C(t)}catch{C("Copying was blocked by the browser.")}}function _t(){ke(),ee(),U("device"),r("name").addEventListener("input",()=>{const e=r("name").value;f.name=F({name:e}).name,T(),V(),L(450)}),r("name").addEventListener("blur",()=>{r("name").value=f.name}),r("tab-presets").addEventListener("click",()=>he("presets")),r("tab-build").addEventListener("click",()=>he("build")),r("view-device").addEventListener("click",()=>U("device")),r("view-patch").addEventListener("click",()=>U("patch")),r("btn-play").addEventListener("click",()=>void Y(!g.playing)),r("btn-bypass").addEventListener("click",()=>{g.bypass=!g.bypass,r("btn-bypass").setAttribute("aria-pressed",String(g.bypass)),r("stage").classList.toggle("is-bypassed",g.bypass)}),r("file").addEventListener("change",()=>{var t;const e=(t=r("file").files)==null?void 0:t[0];e&&fe(e),r("file").value=""}),window.addEventListener("dragover",e=>{var t;(t=e.dataTransfer)!=null&&t.types.includes("Files")&&e.preventDefault()}),window.addEventListener("drop",e=>{var n,s;const t=(s=(n=e.dataTransfer)==null?void 0:n.files)==null?void 0:s[0];t&&(e.preventDefault(),fe(t))}),r("btn-download").addEventListener("click",()=>void yt()),r("btn-python").addEventListener("click",()=>j(!r("drawer").classList.contains("open"))),r("drawer-close").addEventListener("click",()=>j(!1)),r("scrim").addEventListener("click",()=>j(!1)),r("btn-copy").addEventListener("click",()=>{y&&ge(y.script,"Script copied.")}),r("btn-py").addEventListener("click",()=>{y&&Ce(y.script,y.filename.replace(/\.amxd$/,".py"),"text/x-python")}),r("btn-share").addEventListener("click",()=>{history.replaceState(null,"",`#s=${ye(f)}`),ge(location.href,"Link copied. It opens this exact device.")}),window.addEventListener("keydown",e=>{e.key==="Escape"&&r("drawer").classList.contains("open")&&j(!1);const t=e.target,n=t.tagName==="INPUT"||t.tagName==="TEXTAREA",s=t.tagName==="BUTTON"||t.getAttribute("role")==="slider";e.code==="Space"&&!n&&!s&&(e.preventDefault(),Y(!g.playing))}),new ResizeObserver(()=>Q()).observe(r("device-wrap")),O.ready.catch(e=>{P("error","Python failed to start"),r("boot-text").textContent="Python could not start in this browser.",K(String(e.message||e))}),te($),L()}_t();
