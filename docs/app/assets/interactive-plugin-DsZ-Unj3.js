import{H as Xe,I as ae,n as Fe,m as oe,o as ie,J as Oe,E as Be,B as $e,p as je,K as Ie}from"./layout-C7WHoOSq.js";const re=.015;class He{constructor(t){this.buffers=new Map,this.bypassed=!1,this.playing=!1,this.ctx=t;const n=Xe(t);this.feed=new GainNode(t,{gain:1,channelCount:2,channelCountMode:"explicit",channelInterpretation:"speakers"});const s=new ChannelSplitterNode(t,{numberOfOutputs:2});this.feed.connect(s),s.connect(n.input[0],0),s.connect(n.input[1],1),this.wet=new GainNode(t,{gain:1}),this.dry=new GainNode(t,{gain:0}),this.master=new GainNode(t,{gain:1}),this.analyser=new AnalyserNode(t,{fftSize:2048,smoothingTimeConstant:.82}),n.output.disconnect(),n.output.connect(this.wet).connect(this.master),this.feed.connect(this.dry).connect(this.master),this.master.connect(this.analyser),this.master.connect(t.destination),this.meterSplit=new ChannelSplitterNode(t,{numberOfOutputs:2}),this.master.connect(this.meterSplit),this.meters=[0,1].map(a=>{const c=new AnalyserNode(t,{fftSize:512});return this.meterSplit.connect(c,a),c}),this.meterData=this.meters.map(a=>new Float32Array(new ArrayBuffer(a.fftSize*4)))}load(t){let n=this.buffers.get(t.id);return n||(n=fetch(t.url).then(s=>{if(!s.ok)throw new Error(`could not load ${t.label} (${s.status})`);return s.arrayBuffer()}).then(s=>this.ctx.decodeAudioData(s)),n.catch(()=>this.buffers.delete(t.id)),this.buffers.set(t.id,n)),n}decode(t){return this.ctx.decodeAudioData(t)}setBuffer(t){this.buffer=t,this.playing&&this.startSource()}startSource(){if(this.stopSource(),!this.buffer)return;const t=new AudioBufferSourceNode(this.ctx,{buffer:this.buffer,loop:!0});t.connect(this.feed),t.start(),this.source=t}stopSource(){const t=this.source;if(this.source=void 0,!!t){try{t.stop()}catch{}try{t.disconnect()}catch{}}}play(){this.playing=!0,this.startSource()}stop(){this.playing=!1,this.stopSource()}get bypass(){return this.bypassed}set bypass(t){this.bypassed=t;const n=this.ctx.currentTime;this.wet.gain.cancelScheduledValues(n),this.dry.gain.cancelScheduledValues(n),this.wet.gain.setTargetAtTime(t?0:1,n,re),this.dry.gain.setTargetAtTime(t?1:0,n,re)}async duck(t){if(!this.playing||this.ctx.state!=="running")return t();const n=this.master.gain;n.cancelScheduledValues(this.ctx.currentTime),n.setTargetAtTime(0,this.ctx.currentTime,.006),await new Promise(s=>setTimeout(s,30));try{return t()}finally{n.cancelScheduledValues(this.ctx.currentTime),n.setTargetAtTime(1,this.ctx.currentTime+.01,.012)}}levels(){const t=[];for(let n=0;n<2;n++){const s=this.meterData[n];this.meters[n].getFloatTimeDomainData(s);let a=0;for(const c of s)a=Math.max(a,Math.abs(c));t.push(a)}return[t[0],t[1]]}}const we="http://www.w3.org/2000/svg",ye=169;function le(e,t){if(!Array.isArray(e)||e.length<3)return t;const[n,s,a,c=1]=e.map(Number);if(![n,s,a,c].every(Number.isFinite))return t;const d=r=>Math.round(Math.min(1,Math.max(0,r))*255);return`rgba(${d(n)}, ${d(s)}, ${d(a)}, ${c})`}function Ue(e){var n;return(((n=e==null?void 0:e.patcher)==null?void 0:n.boxes)??[]).map(s=>s.box).filter(s=>!!s)}function We(e,t,n){var c,d;e.replaceChildren();const s=Ue(t).filter(r=>Number(r.presentation)===1&&Array.isArray(r.presentation_rect));s.sort((r,l)=>Number(l.background??0)-Number(r.background??0));let a=Number((c=t==null?void 0:t.patcher)==null?void 0:c.devicewidth)||0;for(const r of s){const[l,p,o,m]=r.presentation_rect.map(Number);a=Math.max(a,l+o);const u=document.createElement("div");switch(u.style.cssText=`position:absolute;left:${l}px;top:${p}px;width:${o}px;height:${m}px;`,r.maxclass){case"panel":u.className="dv-panel",u.style.background=le(r.bgcolor,"#1c1e23"),u.style.borderRadius=`${Number(r.rounded??0)}px`;break;case"live.comment":case"comment":{u.className="dv-label",u.textContent=String(r.text??""),u.style.fontSize=`${Number(r.fontsize??10)}px`,u.style.fontWeight=Number(r.fontface??0)===1?"700":"400",u.style.color=le(r.textcolor,"#d5d9e0"),u.style.textAlign=Number(r.textjustification??0)===1?"center":"left",u.style.lineHeight=`${m}px`;break}default:{const h=(d=n.get(String(r.id)))==null?void 0:d.el;if(!h)continue;u.className="dv-widget",u.appendChild(h)}}e.appendChild(u)}return e.style.width=`${a}px`,e.style.height=`${ye}px`,a}const qe=new Set(["panel","live.comment"]);function U(e){var t;return e.maxclass==="live.dial"?Oe(e.raw,"live.dial").longname:e.maxclass==="comment"?String(((t=e.raw)==null?void 0:t.text)??e.text):e.text||e.className}function v(e,t,n){const s=document.createElementNS(we,t);for(const[a,c]of Object.entries(n))s.setAttribute(a,String(c));return e.appendChild(s),s}function Ge(e,t){e.replaceChildren();const n=new Map;let s=0;for(const o of t.nodes){if(qe.has(o.maxclass)){s++;continue}const[m,u,h,D]=o.rect,b=o.maxclass==="live.dial",_=o.maxclass==="comment",R=b?Math.max(h,ae(U(o))+30):Math.max(_?0:h,ae(U(o))+14);n.set(o.id,{x:m,y:u,w:R,h:b?30:Math.max(22,Math.min(D,22)),node:o,authoredRect:[...o.rect]})}let a=0,c=0;for(const o of n.values())a=Math.max(a,o.x+o.w),c=Math.max(c,o.y+o.h);const d=28,r=document.createElementNS(we,"svg");r.setAttribute("viewBox",`0 0 ${a+d} ${c+d}`),r.setAttribute("width",String(a+d)),r.setAttribute("height",String(c+d)),r.classList.add("pv");const l=v(r,"g",{class:"pv-cords"});for(const o of t.edges){const m=n.get(o.from.id),u=n.get(o.to.id);!m||!u||v(l,"path",{d:Fe(ie(m,o.from.outlet),oe(u,o.to.inlet)),class:o.domain==="signal"?"pv-cord is-signal":"pv-cord"})}const p=v(r,"g",{class:"pv-boxes"});for(const o of n.values()){const m=v(p,"g",{transform:`translate(${o.x} ${o.y})`}),u=U(o.node);if(o.node.maxclass==="comment"){v(m,"text",{x:0,y:15,class:"pv-comment"}).textContent=u;continue}const h=o.node.maxclass==="live.dial",D=o.node.outletDomains.includes("signal")||o.node.className.endsWith("~");v(m,"rect",{width:o.w,height:o.h,rx:4,class:`pv-box${D?" is-signal":""}${h?" is-dial":""}`}),h&&(v(m,"circle",{cx:15,cy:15,r:7.5,class:"pv-knob"}),v(m,"line",{x1:15,y1:15,x2:19.5,y2:10.5,class:"pv-knob-needle"})),v(m,"text",{x:h?29:7,y:o.h/2+4,class:"pv-text"}).textContent=u;for(let b=0;b<o.node.numInlets;b++){const _=oe(o,b);v(m,"rect",{x:_.x-o.x-3.5,y:-1,width:7,height:3,rx:1,class:"pv-port"})}for(let b=0;b<o.node.numOutlets;b++){const _=ie(o,b);v(m,"rect",{x:_.x-o.x-3.5,y:o.h-2,width:7,height:3,rx:1,class:`pv-port${o.node.outletDomains[b]==="signal"?" is-signal":""}`})}}return e.appendChild(r),s}const O=e=>e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"),Ve=/\b(import|as|def|return|if|else|for|in|None|True|False)\b/g;function Ke(e){let t=!1;return e.split(`
`).map(n=>{const s=(n.match(/"""|'''/g)??[]).length;if(t||s>0)return s%2===1&&(t=!t),`<span class="c-str">${O(n)}</span>`;const a=Ye(n),c=a<0?n:n.slice(0,a),d=a<0?"":n.slice(a),r=[];let l=0;for(const o of c.matchAll(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g))r.push(ce(c.slice(l,o.index))),r.push(`<span class="c-str">${O(o[0])}</span>`),l=(o.index??0)+o[0].length;r.push(ce(c.slice(l)));const p=d?`<span class="c-com">${O(d).replace(/gap (M4L-\d+)/g,'<span class="c-gap">gap $1</span>')}</span>`:"";return r.join("")+p}).join(`
`)}function ce(e){return O(e).replace(new RegExp("(?<![\\w.])(-?\\d+\\.?\\d*)(?![\\w])","g"),'<span class="c-num">$1</span>').replace(Ve,'<span class="c-kw">$1</span>')}function Ye(e){let t="";for(let n=0;n<e.length;n++){const s=e[n];if(t)s==="\\"?n++:s===t&&(t="");else if(s==='"'||s==="'")t=s;else if(s==="#")return n}return-1}const Je=[{id:"filter",label:"Filter",blurb:"State-variable filter (svf~). Park it to shape the tone, or sweep the cutoff by hand.",options:[{id:"mode",label:"Type",default:"lowpass",choices:[{id:"lowpass",label:"Low-pass"},{id:"highpass",label:"High-pass"},{id:"bandpass",label:"Band-pass"},{id:"notch",label:"Notch"}]}],params:[{id:"cutoff",label:"Cutoff",min:40,max:1e4,default:1800,unit:"Hz",exponent:3},{id:"res",label:"Reso",min:0,max:100,default:30,unit:"%",exponent:1}]},{id:"drive",label:"Distortion",blurb:"Five kinds of clipping, a tone control after it, and automatic level matching so more drive means more dirt, not more volume.",options:[{id:"character",label:"Type",default:"soft",choices:[{id:"soft",label:"Overdrive"},{id:"tube",label:"Tube"},{id:"hard",label:"Hard clip"},{id:"fuzz",label:"Fuzz"},{id:"fold",label:"Fold"}]}],params:[{id:"amount",label:"Drive",min:1,max:10,default:3,unit:"x",exponent:1.5},{id:"tone",label:"Tone",min:400,max:1e4,default:8e3,unit:"Hz",exponent:3}]},{id:"crush",label:"Crush",blurb:"Bit depth and sample rate reduction with degrade~. Lo-fi on demand.",options:[],params:[{id:"rate",label:"Rate",min:2,max:100,default:35,unit:"%",exponent:2},{id:"bits",label:"Bits",min:2,max:16,default:8,unit:"bit",exponent:1,integer:!0}]},{id:"chorus",label:"Chorus",blurb:"A swept delay line per channel, moving in opposite directions for width. Flanger swaps it for a short comb~ with feedback.",options:[{id:"voice",label:"Type",default:"chorus",choices:[{id:"chorus",label:"Chorus"},{id:"flanger",label:"Flanger"}]}],params:[{id:"rate",label:"Rate",min:.05,max:8,default:.6,unit:"Hz",exponent:2},{id:"depth",label:"Depth",min:0,max:8,default:3,unit:"ms",exponent:1},{id:"mix",label:"Mix",min:0,max:100,default:50,unit:"%",exponent:1}]},{id:"tremolo",label:"Tremolo",blurb:"An LFO on the volume. Switch to auto-pan to move it between the speakers.",options:[{id:"mode",label:"Mode",default:"tremolo",choices:[{id:"tremolo",label:"Tremolo"},{id:"autopan",label:"Auto-pan"}]}],params:[{id:"rate",label:"Rate",min:.1,max:20,default:5,unit:"Hz",exponent:2},{id:"depth",label:"Depth",min:0,max:100,default:60,unit:"%",exponent:1}]},{id:"delay",label:"Delay",blurb:"Feedback delay on a tapin~ / tapout~ pair. The time glides when you turn it, like tape. Repeats saturate like tape instead of running away. Ping-pong bounces them left and right.",options:[{id:"style",label:"Style",default:"stereo",choices:[{id:"stereo",label:"Stereo"},{id:"pingpong",label:"Ping-pong"}]}],params:[{id:"time",label:"Time",min:10,max:1500,default:320,unit:"ms",exponent:2},{id:"feedback",label:"Feedback",short:"Fdbk",min:0,max:90,default:40,unit:"%",exponent:1},{id:"mix",label:"Mix",min:0,max:100,default:30,unit:"%",exponent:1}]},{id:"reverb",label:"Reverb",blurb:"Freeverb's layout: eight comb~ filters into four allpass~ stages per channel, level-matched so a long tail is not a loud one.",options:[],params:[{id:"size",label:"Size",min:0,max:100,default:55,unit:"%",exponent:1},{id:"damp",label:"Damp",min:500,max:1e4,default:6e3,unit:"Hz",exponent:3},{id:"mix",label:"Mix",min:0,max:100,default:25,unit:"%",exponent:1}]}],Ze={id:"output",label:"Output",params:[{id:"gain",label:"Gain",min:-24,max:12,default:0,unit:"dB",exponent:1}]},Qe=["#ff7a45","#f5c542","#4bd08a","#38bdf8","#a78bfa","#f472b6"],et={modules:Je,output:Ze,accents:Qe},tt=[{id:"tube",name:"Warm Tube",tag:"A gentle push into smooth tanh saturation",group:"Distortion",sample:"guitar",settings:{name:"Warm Tube",accent:"#ff7a45",chain:[{module:"drive",on:!0,options:{character:"tube"},values:{amount:2.5,tone:7500}}],output:{gain:0}}},{id:"overdrive",name:"Overdrive",tag:"Max's own overdrive~, turned up halfway",group:"Distortion",sample:"guitar",settings:{name:"Overdrive",accent:"#ff7a45",chain:[{module:"drive",on:!0,options:{character:"soft"},values:{amount:5,tone:6500}}],output:{gain:0}}},{id:"crunch",name:"Crunch",tag:"Hard clipping with the top rolled off",group:"Distortion",sample:"drums",settings:{name:"Crunch",accent:"#f5c542",chain:[{module:"drive",on:!0,options:{character:"hard"},values:{amount:4,tone:5200}}],output:{gain:0}}},{id:"fuzz",name:"Fuzz Box",tag:"Lopsided clipping, square and buzzy",group:"Distortion",sample:"guitar",settings:{name:"Fuzz Box",accent:"#f472b6",chain:[{module:"drive",on:!0,options:{character:"fuzz"},values:{amount:6,tone:4200}}],output:{gain:0}}},{id:"fold",name:"Wavefolder",tag:"Peaks fold back on themselves instead of flattening",group:"Distortion",sample:"piano",settings:{name:"Wavefolder",accent:"#a78bfa",chain:[{module:"drive",on:!0,options:{character:"fold"},values:{amount:2.6,tone:8e3}}],output:{gain:0}}},{id:"shoegaze",name:"Shoegaze Wall",tag:"Overdrive into chorus into echo into a long room",group:"Distortion",sample:"guitar",settings:{name:"Shoegaze Wall",accent:"#f472b6",chain:[{module:"drive",on:!0,options:{character:"soft"},values:{amount:6,tone:6e3}},{module:"chorus",on:!0,options:{voice:"chorus"},values:{rate:.5,depth:4,mix:50}},{module:"delay",on:!0,options:{style:"stereo"},values:{time:420,feedback:50,mix:28}},{module:"reverb",on:!0,options:{},values:{size:80,damp:5e3,mix:42}}],output:{gain:2}}},{id:"tape",name:"Tape Lo-Fi",tag:"Worn cassette: soft crush, dull top, slow wobble",group:"Lo-Fi",sample:"piano",settings:{name:"Tape Lo-Fi",accent:"#f5c542",chain:[{module:"crush",on:!0,options:{},values:{rate:48,bits:11}},{module:"filter",on:!0,options:{mode:"lowpass"},values:{cutoff:3400,res:10}},{module:"chorus",on:!0,options:{voice:"chorus"},values:{rate:.35,depth:2.4,mix:38}}],output:{gain:0}}},{id:"arcade",name:"8-Bit Arcade",tag:"Five bits and a tenth of the sample rate",group:"Lo-Fi",sample:"drums",settings:{name:"8-Bit Arcade",accent:"#4bd08a",chain:[{module:"crush",on:!0,options:{},values:{rate:11,bits:5}}],output:{gain:-2}}},{id:"telephone",name:"Telephone",tag:"Narrow band-pass with a clipped edge",group:"Lo-Fi",sample:"vocals",settings:{name:"Telephone",accent:"#f5c542",chain:[{module:"filter",on:!0,options:{mode:"bandpass"},values:{cutoff:1500,res:45}},{module:"drive",on:!0,options:{character:"hard"},values:{amount:4,tone:3600}}],output:{gain:3}}},{id:"speaker",name:"Blown Speaker",tag:"Fuzz, a crushed top end and no highs",group:"Lo-Fi",sample:"drums",settings:{name:"Blown Speaker",accent:"#ff7a45",chain:[{module:"drive",on:!0,options:{character:"fuzz"},values:{amount:3,tone:3e3}},{module:"crush",on:!0,options:{},values:{rate:55,bits:9}},{module:"filter",on:!0,options:{mode:"lowpass"},values:{cutoff:2600,res:25}}],output:{gain:0}}},{id:"underwater",name:"Underwater",tag:"Everything above 600 Hz gone, and drifting",group:"Filter",sample:"guitar",settings:{name:"Underwater",accent:"#38bdf8",chain:[{module:"filter",on:!0,options:{mode:"lowpass"},values:{cutoff:620,res:55}},{module:"chorus",on:!0,options:{voice:"chorus"},values:{rate:.22,depth:6,mix:60}},{module:"reverb",on:!0,options:{},values:{size:70,damp:1600,mix:40}}],output:{gain:3}}},{id:"sweep",name:"Resonant Low-Pass",tag:"A sharp peak, ready to be swept by hand",group:"Filter",sample:"drums",settings:{name:"Resonant Low-Pass",accent:"#ff7a45",chain:[{module:"filter",on:!0,options:{mode:"lowpass"},values:{cutoff:900,res:85}}],output:{gain:0}}},{id:"thin",name:"Thin Air",tag:"High-pass at 900 Hz: all air, no body",group:"Filter",sample:"vocals",settings:{name:"Thin Air",accent:"#38bdf8",chain:[{module:"filter",on:!0,options:{mode:"highpass"},values:{cutoff:900,res:25}}],output:{gain:2}}},{id:"notch",name:"Hollow Notch",tag:"A notch scooped out of the middle",group:"Filter",sample:"piano",settings:{name:"Hollow Notch",accent:"#a78bfa",chain:[{module:"filter",on:!0,options:{mode:"notch"},values:{cutoff:1100,res:70}}],output:{gain:0}}},{id:"wide",name:"Wide Chorus",tag:"Doubles the sound and spreads it out",group:"Chorus",sample:"piano",settings:{name:"Wide Chorus",accent:"#4bd08a",chain:[{module:"chorus",on:!0,options:{voice:"chorus"},values:{rate:.8,depth:4,mix:50}}],output:{gain:0}}},{id:"ensemble",name:"Slow Ensemble",tag:"Deep, slow and lush",group:"Chorus",sample:"guitar",settings:{name:"Slow Ensemble",accent:"#38bdf8",chain:[{module:"chorus",on:!0,options:{voice:"chorus"},values:{rate:.25,depth:7,mix:50}},{module:"reverb",on:!0,options:{},values:{size:40,damp:6e3,mix:18}}],output:{gain:0}}},{id:"vibrato",name:"Vibrato",tag:"All wet: the pitch wobbles, nothing is doubled",group:"Chorus",sample:"vocals",settings:{name:"Vibrato",accent:"#f472b6",chain:[{module:"chorus",on:!0,options:{voice:"chorus"},values:{rate:5,depth:1.5,mix:100}}],output:{gain:0}}},{id:"jet",name:"Jet Flanger",tag:"A short swept comb with feedback",group:"Chorus",sample:"drums",settings:{name:"Jet Flanger",accent:"#a78bfa",chain:[{module:"chorus",on:!0,options:{voice:"flanger"},values:{rate:.2,depth:7,mix:50}}],output:{gain:0}}},{id:"surf",name:"Surf Tremolo",tag:"Fast tremolo into a splashy room",group:"Tremolo",sample:"guitar",settings:{name:"Surf Tremolo",accent:"#38bdf8",chain:[{module:"tremolo",on:!0,options:{mode:"tremolo"},values:{rate:6.5,depth:75}},{module:"reverb",on:!0,options:{},values:{size:52,damp:5200,mix:28}}],output:{gain:1}}},{id:"pulse",name:"Slow Pulse",tag:"A gentle swell, twice a second",group:"Tremolo",sample:"piano",settings:{name:"Slow Pulse",accent:"#4bd08a",chain:[{module:"tremolo",on:!0,options:{mode:"tremolo"},values:{rate:2,depth:55}}],output:{gain:1}}},{id:"chopper",name:"Helicopter",tag:"Full depth, twelve times a second",group:"Tremolo",sample:"vocals",settings:{name:"Helicopter",accent:"#ff7a45",chain:[{module:"tremolo",on:!0,options:{mode:"tremolo"},values:{rate:12,depth:100}}],output:{gain:3}}},{id:"drift",name:"Auto-Pan Drift",tag:"Slow side-to-side movement with a faint echo",group:"Tremolo",sample:"piano",settings:{name:"Auto-Pan Drift",accent:"#f472b6",chain:[{module:"tremolo",on:!0,options:{mode:"autopan"},values:{rate:.45,depth:92}},{module:"delay",on:!0,options:{style:"stereo"},values:{time:260,feedback:28,mix:18}}],output:{gain:1}}},{id:"slapback",name:"Slapback",tag:"One quick repeat, rockabilly style",group:"Delay",sample:"vocals",settings:{name:"Slapback",accent:"#38bdf8",chain:[{module:"delay",on:!0,options:{style:"stereo"},values:{time:115,feedback:6,mix:34}}],output:{gain:0}}},{id:"quarter",name:"Quarter Echo",tag:"Half-second repeats that fade away",group:"Delay",sample:"guitar",settings:{name:"Quarter Echo",accent:"#4bd08a",chain:[{module:"delay",on:!0,options:{style:"stereo"},values:{time:500,feedback:42,mix:28}}],output:{gain:0}}},{id:"pingpong",name:"Ping-Pong",tag:"Repeats bouncing left and right",group:"Delay",sample:"drums",settings:{name:"Ping-Pong",accent:"#a78bfa",chain:[{module:"delay",on:!0,options:{style:"pingpong"},values:{time:300,feedback:50,mix:34}}],output:{gain:0}}},{id:"dub",name:"Dub Echo",tag:"Dark ping-pong repeats that keep on going",group:"Delay",sample:"drums",settings:{name:"Dub Echo",accent:"#4bd08a",chain:[{module:"filter",on:!0,options:{mode:"highpass"},values:{cutoff:320,res:5}},{module:"delay",on:!0,options:{style:"pingpong"},values:{time:375,feedback:66,mix:40}},{module:"reverb",on:!0,options:{},values:{size:45,damp:4200,mix:14}}],output:{gain:0}}},{id:"room",name:"Small Room",tag:"A short, tight space",group:"Reverb",sample:"drums",settings:{name:"Small Room",accent:"#f5c542",chain:[{module:"reverb",on:!0,options:{},values:{size:12,damp:7e3,mix:22}}],output:{gain:0}}},{id:"hall",name:"Concert Hall",tag:"Big and smooth, two seconds of tail",group:"Reverb",sample:"piano",settings:{name:"Concert Hall",accent:"#38bdf8",chain:[{module:"reverb",on:!0,options:{},values:{size:62,damp:5500,mix:32}}],output:{gain:0}}},{id:"cathedral",name:"Cathedral",tag:"A very long, bright tail",group:"Reverb",sample:"vocals",settings:{name:"Cathedral",accent:"#a78bfa",chain:[{module:"filter",on:!0,options:{mode:"highpass"},values:{cutoff:180,res:0}},{module:"reverb",on:!0,options:{},values:{size:92,damp:7500,mix:50}}],output:{gain:0}}},{id:"station",name:"Space Station",tag:"Wide echoes dissolving into reverb",group:"Reverb",sample:"piano",settings:{name:"Space Station",accent:"#a78bfa",chain:[{module:"delay",on:!0,options:{style:"pingpong"},values:{time:540,feedback:68,mix:42}},{module:"reverb",on:!0,options:{},values:{size:82,damp:3600,mix:42}}],output:{gain:0}}},{id:"init",name:"Clean Slate",tag:"Nothing switched on. Build your own from here.",group:"Start",sample:null,settings:{name:"Clean Slate",accent:"#9aa3ad",chain:[],output:{gain:0}}}],w=et,Y=tt,J=e=>w.modules.find(t=>t.id===e),de="MaxPy FX";function xe(e,t){let n=Number(t);return Number.isFinite(n)||(n=e.default),n=Math.min(e.max,Math.max(e.min,n)),e.integer?Math.round(n):n}function ue(e,t){var a,c;const n={};for(const d of e.options){const r=(a=t.options)==null?void 0:a[d.id];n[d.id]=d.choices.some(l=>l.id===r)?r:d.default}const s={};for(const d of e.params)s[d.id]=xe(d,((c=t.values)==null?void 0:c[d.id])??d.default);return{module:e.id,on:t.on??!0,options:n,values:s}}function I(e){var r;const t=e&&typeof e=="object"?e:{},n=String(t.name??de).replace(/[^A-Za-z0-9 _-]/g,"").trim().slice(0,32)||de,s=typeof t.accent=="string"&&/^#[0-9a-fA-F]{6}$/.test(t.accent)?t.accent.toLowerCase():w.accents[0],a=[],c=new Set;for(const l of Array.isArray(t.chain)?t.chain:[]){const p=l&&typeof l=="object"?J(l.module):void 0;!p||c.has(p.id)||(c.add(p.id),a.push(ue(p,l)))}for(const l of w.modules)c.has(l.id)||a.push(ue(l,{on:!1}));const d={};for(const l of w.output.params)d[l.id]=xe(l,((r=t.output)==null?void 0:r[l.id])??l.default);return{name:n,accent:s,chain:a,output:d}}function nt(){const e=(n,s)=>`${n} ${s}`.toLowerCase().replace(/ /g,"_"),t=new Map;for(const n of w.modules)for(const s of n.params)t.set(e(n.label,s.label),{module:n.id,param:s.id});for(const n of w.output.params)t.set(e(w.output.label,n.label),{module:w.output.id,param:n.id});return t}function _e(e){const t={name:e.name,accent:e.accent,chain:e.chain.filter(a=>a.on).map(a=>({module:a.module,on:!0,options:a.options,values:a.values})),output:e.output},n=new TextEncoder().encode(JSON.stringify(t));let s="";for(const a of n)s+=String.fromCharCode(a);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}function st(e){try{const t=e.replace(/-/g,"+").replace(/_/g,"/"),n=atob(t),s=Uint8Array.from(n,a=>a.charCodeAt(0));return I(JSON.parse(new TextDecoder().decode(s)))}catch{return}}const at=`"""
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
import math
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
BRAND_W = 128
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
    s = "%g" % float(v)   # six significant digits
    if "e" in s:
        s = ("%.8f" % float(v)).rstrip("0")
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
        self.names = set()

    def emit(self, line=""):
        self.lines.append(line)

    def name(self, var):
        """
        Claim a variable name in the emitted program. A name used twice would quietly
        rebind it, and every cord written against the first object would land on the
        second, so it is an error here rather than a wrong patch later.
        """
        if var in self.names:
            raise ValueError("fxgen: the name %r is already taken in the generated script" % var)
        self.names.add(var)
        return var

    def place(self, var, text, x, y):
        self.emit('%s = place("%s", %d, %d)' % (self.name(var), text, x, y))
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
        var = self.s.name("%s_%s" % (mod["id"], param["id"]))
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

    def mix(self, prefix, mix_dial, mix_value, dry, wet, row, ctl_row=0, equal_power=False):
        """
        Dry/wet crossfade for both channels. \`dry\` and \`wet\` map a channel to the outlet
        expression carrying it. \`row\` is the signal row the crossfade starts on; \`ctl_row\`
        the control row its math starts on. Returns the outgoing signal and the number of
        signal rows used so far.

        Linear (dry * (1 - mix) + wet * mix) is right when the wet signal is a copy of the
        dry one, as in a chorus: the two add up in step. Echoes and reverb are not in step
        with the dry signal, and a linear fade would dip in level around the middle, so
        those use an equal-power fade: dry * cos(mix * pi/2) + wet * sin(mix * pi/2).
        """
        s = self.s
        m = mix_value / 100.0
        y = self.sig(row)
        x = XC + 2 * DX
        if equal_power:
            turn = math.pi / 2
            dry_gain, wet_gain = math.cos(m * turn), math.sin(m * turn)
            s.place(prefix + "_turn", "* %s" % fnum(turn / 100.0), x, self.ctl(ctl_row))
            s.place(prefix + "_wet", "sin", x, self.ctl(ctl_row + 1))
            s.place(prefix + "_dry", "cos", x + 60, self.ctl(ctl_row + 1))
            s.wire("%s.outs[0]" % mix_dial, "%s_turn.ins[0]" % prefix)
            s.wire("%s_turn.outs[0]" % prefix, "%s_wet.ins[0]" % prefix)
            s.wire("%s_turn.outs[0]" % prefix, "%s_dry.ins[0]" % prefix)
        else:
            dry_gain, wet_gain = 1 - m, m
            s.place(prefix + "_wet", "* 0.01", x, self.ctl(ctl_row))
            s.place(prefix + "_dry", "!- 1.", x, self.ctl(ctl_row + 1))
            s.wire("%s.outs[0]" % mix_dial, "%s_wet.ins[0]" % prefix)
            s.wire("%s_wet.outs[0]" % prefix, "%s_dry.ins[0]" % prefix)
        out = {}
        for ch in ("L", "R"):
            d, w, a = "%s_dry%s" % (prefix, ch), "%s_wet%s" % (prefix, ch), "%s_out%s" % (prefix, ch)
            s.place(d, "*~ %s" % fnum(dry_gain), X[ch], y)
            s.place(w, "*~ %s" % fnum(wet_gain), X[ch] + SUB, y)
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

# The Reso dial runs 0 to 100 percent and is mapped onto the useful part of svf~'s 0 to 1
# resonance. Measured in Max, svf~ is flat until about 0.17, and by 0.9 its peak is 36 dB
# high and rings for seconds, so the dial stops at 0.75 (a peak of about 21 dB).
SVF_RES = (0.17, 0.75)


def svf_resonance(percent):
    lo, hi = SVF_RES
    return lo + (hi - lo) * float(percent) / 100.0


def filter_trim(percent):
    """Input gain that falls as the resonance rises, so the peak has headroom to ring in."""
    return 1.0 - 0.005 * float(percent)


def m_filter(dev, src, opt, val):
    s = dev.s
    d = dev.dials(_module("filter"), val, math_rows=2)
    outlet = {"lowpass": 0, "highpass": 1, "bandpass": 2, "notch": 3}[opt["mode"]]
    s.place("filter_reso", "scale 0. 100. %s %s" % (fnum(SVF_RES[0]), fnum(SVF_RES[1])), XC + DX, dev.ctl(0))
    # trim = 1 - reso / 200: half the level at full resonance
    s.place("filter_half", "* -0.005", XC + 2 * DX + 40, dev.ctl(0))
    s.place("filter_trim", "+ 1.", XC + 2 * DX + 40, dev.ctl(1))
    s.wire(d["res"] + ".outs[0]", "filter_reso.ins[0]")
    s.wire(d["res"] + ".outs[0]", "filter_half.ins[0]")
    s.wire("filter_half.outs[0]", "filter_trim.ins[0]")
    out = {}
    for ch in ("L", "R"):
        g = s.place("filter_in" + ch, "*~ %s" % fnum(filter_trim(val["res"])), X[ch], dev.sig(0))
        v = s.place("filter_" + ch, "svf~ %s %s" % (fnum(val["cutoff"]), fnum(svf_resonance(val["res"]))), X[ch], dev.sig(1))
        s.wire(src[ch], g + ".ins[0]")
        s.wire("filter_trim.outs[0]", g + ".ins[1]")
        s.wire(g + ".outs[0]", v + ".ins[0]")
        s.wire(d["cutoff"] + ".outs[0]", v + ".ins[1]")
        s.wire("filter_reso.outs[0]", v + ".ins[2]")
        out[ch] = "%s.outs[%d]" % (v, outlet)  # svf~ outlets: lowpass, highpass, bandpass, notch
    return out, 2


# Makeup gain per distortion type: scale * drive ** exponent. A clipper flattens the peaks
# as the drive rises, so without this the Drive dial would mostly be a volume dial. The
# numbers were set by rendering each type in Max at drive 1, 3 and 10 and matching the
# output level to the input's.
DRIVE_MAKEUP = {"soft": (1.0, -0.5), "tube": (1.0, -0.5), "hard": (0.85, -0.5),
                "fuzz": (0.56, -0.25), "fold": (1.0, -0.4)}
FUZZ_PUSH = 4.0   # fuzz hits its clipper this much harder than the dial reads
DC_BLOCK = "biquad~ 1. -1. 0. -0.998 0."   # y = x - x[n-1] + 0.998 * y[n-1], a 14 Hz high-pass


def drive_makeup(character, amount):
    scale, exponent = DRIVE_MAKEUP[character]
    return scale * float(amount) ** exponent


def m_drive(dev, src, opt, val):
    s = dev.s
    kind = opt["character"]
    d = dev.dials(_module("drive"), val, math_rows=2)
    # makeup = scale * drive ** exponent
    s.place("drive_root", "pow %s" % fnum(DRIVE_MAKEUP[kind][1]), XC + 2 * DX, dev.ctl(0))
    s.place("drive_makeup", "* %s" % fnum(DRIVE_MAKEUP[kind][0]), XC + 2 * DX, dev.ctl(1))
    s.wire(d["amount"] + ".outs[0]", "drive_root.ins[0]")
    s.wire("drive_root.outs[0]", "drive_makeup.ins[0]")
    push = d["amount"] + ".outs[0]"
    if kind == "fuzz":
        s.place("drive_push", "* %s" % fnum(FUZZ_PUSH), XC, dev.ctl(0))
        s.wire(d["amount"] + ".outs[0]", "drive_push.ins[0]")
        push = "drive_push.outs[0]"
    out = {}
    rows = 0
    for ch in ("L", "R"):
        row = 0
        if kind == "soft":
            # overdrive~ has its own gain: 1 is clean, 10 is as far as it goes.
            g = s.place("drive_" + ch, "overdrive~ %s" % fnum(val["amount"]), X[ch], dev.sig(row))
            s.wire(src[ch], g + ".ins[0]")
            s.wire(push, g + ".ins[1]")
            shaped = g + ".outs[0]"
            row += 1
        else:
            pre = val["amount"] * (FUZZ_PUSH if kind == "fuzz" else 1.0)
            g = s.place("drive_" + ch, "*~ %s" % fnum(pre), X[ch], dev.sig(row))
            s.wire(src[ch], g + ".ins[0]")
            s.wire(push, g + ".ins[1]")
            row += 1
            if kind == "tube":
                c = s.place("drive_shape" + ch, "tanh~", X[ch], dev.sig(row))
                s.wire(g + ".outs[0]", c + ".ins[0]")
            elif kind == "hard":
                c = s.place("drive_shape" + ch, "clip~ -1. 1.", X[ch], dev.sig(row))
                s.wire(g + ".outs[0]", c + ".ins[0]")
            elif kind == "fold":
                # pong~ mode 0 folds the wave back at the limits instead of flattening it.
                c = s.place("drive_shape" + ch, "pong~ 0 -1. 1.", X[ch], dev.sig(row))
                s.wire(g + ".outs[0]", c + ".ins[0]")
            else:  # fuzz
                # Lopsided clipping: an offset pushes one half of the wave into the rail
                # first. The offset would leave DC, so a one-zero, one-pole blocker follows.
                o = s.place("drive_bias" + ch, "+~ 0.2", X[ch], dev.sig(row))
                k = s.place("drive_clip" + ch, "clip~ -0.35 1.", X[ch], dev.sig(row + 1))
                c = s.place("drive_shape" + ch, DC_BLOCK, X[ch], dev.sig(row + 2))
                s.wire(g + ".outs[0]", o + ".ins[0]")
                s.wire(o + ".outs[0]", k + ".ins[0]")
                s.wire(k + ".outs[0]", c + ".ins[0]")
                row += 2
            shaped = c + ".outs[0]"
            row += 1
        t = s.place("drive_tone" + ch, "onepole~ %s" % fnum(val["tone"]), X[ch], dev.sig(row))
        m = s.place("drive_level" + ch, "*~ %s" % fnum(drive_makeup(kind, val["amount"])), X[ch], dev.sig(row + 1))
        s.wire(shaped, t + ".ins[0]")
        s.wire(d["tone"] + ".outs[0]", t + ".ins[1]")
        s.wire(t + ".outs[0]", m + ".ins[0]")
        s.wire("drive_makeup.outs[0]", m + ".ins[1]")
        out[ch] = m + ".outs[0]"
        rows = row + 2
    return out, rows


def m_crush(dev, src, opt, val):
    s = dev.s
    d = dev.dials(_module("crush"), val, math_rows=1)
    s.place("crush_ratio", "* 0.01", XC, dev.ctl(0))
    s.wire(d["rate"] + ".outs[0]", "crush_ratio.ins[0]")
    out = {}
    for ch in ("L", "R"):
        v = s.place("crush_" + ch, "degrade~ %s %d" % (fnum(val["rate"] / 100.0), int(val["bits"])), X[ch], dev.sig(0))
        # degrade~ rounds every sample the same way, which shifts the whole wave off
        # centre at low bit depths. The blocker takes that offset back out.
        b = s.place("crush_dc" + ch, DC_BLOCK, X[ch], dev.sig(1))
        s.wire(src[ch], v + ".ins[0]")
        s.wire("crush_ratio.outs[0]", v + ".ins[1]")
        s.wire(d["bits"] + ".outs[0]", v + ".ins[2]")
        s.wire(v + ".outs[0]", b + ".ins[0]")
        out[ch] = b + ".outs[0]"
    return out, 2


# Chorus sweeps a 12 ms tapin~ / tapout~ line by the full depth. A flanger is a much
# shorter line with a narrower sweep and some of its output fed back in, which is what
# makes the comb peaks ring. That is exactly a comb~ with its delay time swept, so the
# flanger is one comb~ per channel.
CHORUS = {"chorus": {"base": 12.0, "sweep": 1.0}, "flanger": {"base": 3.0, "sweep": 0.3}}
FLANGER_FEEDBACK = 0.5
FLANGER_TRIM = 0.7  # feedback rings up to twice the level at its peaks; this keeps the mix under full scale


def m_chorus(dev, src, opt, val):
    s = dev.s
    flanger = opt["voice"] == "flanger"
    v = CHORUS[opt["voice"]]
    d = dev.dials(_module("chorus"), val, math_rows=3)
    s.place("chorus_lfo", "cycle~ %s" % fnum(val["rate"]), XC, dev.ctl(0))
    s.place("chorus_depth_sig", "*~ %s" % fnum(val["depth"] * v["sweep"]), XC, dev.ctl(1))
    s.place("chorus_invert", "*~ -1.", XC, dev.ctl(2))
    s.wire(d["rate"] + ".outs[0]", "chorus_lfo.ins[0]")
    s.wire("chorus_lfo.outs[0]", "chorus_depth_sig.ins[0]")
    if v["sweep"] == 1.0:
        s.wire(d["depth"] + ".outs[0]", "chorus_depth_sig.ins[1]")
    else:
        s.place("chorus_narrow", "* %s" % fnum(v["sweep"]), XC + DX, dev.ctl(0))
        s.wire(d["depth"] + ".outs[0]", "chorus_narrow.ins[0]")
        s.wire("chorus_narrow.outs[0]", "chorus_depth_sig.ins[1]")
    s.wire("chorus_depth_sig.outs[0]", "chorus_invert.ins[0]")
    sweep = {"L": "chorus_depth_sig.outs[0]", "R": "chorus_invert.outs[0]"}
    wet = {}
    for ch in ("L", "R"):
        # The delay time, in ms, as a signal: the base time plus or minus the sweep.
        t = s.place("chorus_time" + ch, "+~ %s" % fnum(v["base"]), X[ch] + SUB, dev.sig(0))
        s.wire(sweep[ch], t + ".ins[0]")
        if flanger:
            # comb~ arguments: longest delay, delay, direct, delayed, feedback. The delay
            # is left at 0 because the signal in the second inlet sets it.
            c = s.place("chorus_comb" + ch, "comb~ 20 0. 0. 1. %s" % fnum(FLANGER_FEEDBACK), X[ch], dev.sig(1))
            g = s.place("chorus_trim" + ch, "*~ %s" % fnum(FLANGER_TRIM), X[ch], dev.sig(2))
            s.wire(src[ch], c + ".ins[0]")
            s.wire(t + ".outs[0]", c + ".ins[1]")
            s.wire(c + ".outs[0]", g + ".ins[0]")
            wet[ch] = g + ".outs[0]"
        else:
            i = s.place("chorus_in" + ch, "tapin~ 100", X[ch], dev.sig(0))
            o = s.place("chorus_tap" + ch, "tapout~", X[ch], dev.sig(1))
            s.wire(src[ch], i + ".ins[0]")
            s.wire(i + ".outs[0]", o + ".ins[0]")
            s.wire(t + ".outs[0]", o + ".ins[0]")
            wet[ch] = o + ".outs[0]"
    return dev.mix("chorus", d["mix"], val["mix"], src, wet, 3 if flanger else 2)


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


DELAY_GLIDE = 80  # ms the delay time takes to reach a new dial position
# The feedback path runs through 0.5 * tanh(2 * x): unity gain for quiet echoes, and a
# ceiling at half scale for loud ones. Repeats that pile up saturate, the way tape does,
# instead of growing until they hit the output clip.
LOOP_CEILING = 0.5


def m_delay(dev, src, opt, val):
    s = dev.s
    d = dev.dials(_module("delay"), val, math_rows=2)
    # The time reaches the taps as a signal that glides to each new value. Sent as a plain
    # number it would jump, and a jump in a delay line is a click.
    s.place("delay_ramp", "pack 0. %d" % DELAY_GLIDE, XC, dev.ctl(0))
    s.place("delay_time_sig", "line~ %s" % fnum(val["time"]), XC, dev.ctl(1))
    s.place("delay_fb", "* %s" % fnum(0.01 / LOOP_CEILING), XC + DX, dev.ctl(0))
    s.wire(d["time"] + ".outs[0]", "delay_ramp.ins[0]")
    s.wire("delay_ramp.outs[0]", "delay_time_sig.ins[0]")
    s.wire(d["feedback"] + ".outs[0]", "delay_fb.ins[0]")
    wet = {}
    for ch in ("L", "R"):
        i = s.place("delay_in" + ch, "tapin~ 2000", X[ch], dev.sig(0))
        o = s.place("delay_tap" + ch, "tapout~", X[ch], dev.sig(1))
        f = s.place("delay_fb" + ch, "*~ %s" % fnum(val["feedback"] / 100.0 / LOOP_CEILING), X[ch] + SUB, dev.sig(2))
        k = s.place("delay_tanh" + ch, "tanh~", X[ch] + SUB, dev.sig(3))
        t = s.place("delay_sat" + ch, "*~ %s" % fnum(LOOP_CEILING), X[ch] + SUB, dev.sig(4))
        s.wire(i + ".outs[0]", o + ".ins[0]")
        s.wire("delay_time_sig.outs[0]", o + ".ins[0]")
        s.wire(o + ".outs[0]", f + ".ins[0]")
        s.wire("delay_fb.outs[0]", f + ".ins[1]")
        s.wire(f + ".outs[0]", k + ".ins[0]")
        s.wire(k + ".outs[0]", t + ".ins[0]")
        wet[ch] = o + ".outs[0]"
    if opt["style"] == "pingpong":
        # Left and right are averaged into the left line; each side's echo then feeds the
        # other side's line, so the repeats alternate.
        s.place("delay_mono", "*~ 0.5", X["L"], dev.sig(5))
        s.wire(src["L"], "delay_mono.ins[0]")
        s.wire(src["R"], "delay_mono.ins[0]")
        s.wire("delay_mono.outs[0]", "delay_inL.ins[0]")
        s.wire("delay_satL.outs[0]", "delay_inR.ins[0]")
        s.wire("delay_satR.outs[0]", "delay_inL.ins[0]")
        rows = 6
    else:
        for ch in ("L", "R"):
            s.wire(src[ch], "delay_in%s.ins[0]" % ch)
            s.wire("delay_sat%s.outs[0]" % ch, "delay_in%s.ins[0]" % ch)
        rows = 5
    return dev.mix("delay", d["mix"], val["mix"], src, wet, rows, equal_power=True)


# The reverb is Freeverb's layout: eight parallel combs into four allpasses in series,
# with its delay lengths (given there in samples at 44.1 kHz, here in ms). The right
# channel's lines are 23 samples longer, which is what makes the tail wide instead of the
# same reverb in both speakers.
COMBS = (25.31, 26.94, 28.96, 30.75, 32.24, 33.81, 35.31, 36.67)
ALLPASSES = (12.61, 10.0, 7.73, 5.1)
SPREAD = {"L": 0.0, "R": 0.52}
REVERB_FB = (0.7, 0.97)


def reverb_feedback(size):
    lo, hi = REVERB_FB
    return lo + (hi - lo) * float(size) / 100.0


def reverb_level(feedback):
    """
    What the summed combs are scaled by. A comb with feedback g raises the level of what
    passes through it by 1 / sqrt(1 - g * g), so a long tail would also be a loud one.
    Dividing by that undoes it, and dividing by sqrt(8) averages the eight combs.
    """
    return (1.0 - feedback * feedback) ** 0.5 / len(COMBS) ** 0.5


def m_reverb(dev, src, opt, val):
    s = dev.s
    d = dev.dials(_module("reverb"), val, math_rows=3)
    fb = reverb_feedback(val["size"])
    s.place("reverb_fb", "scale 0. 100. %s %s" % (fnum(REVERB_FB[0]), fnum(REVERB_FB[1])), XC, dev.ctl(0))
    # level = sqrt(1 - fb * fb) / sqrt(8), one object per step
    s.place("reverb_square", "pow 2.", XC, dev.ctl(1))
    s.place("reverb_rest", "!- 1.", XC, dev.ctl(2))
    s.place("reverb_root", "sqrt", XC + DX, dev.ctl(1))
    s.place("reverb_level", "* %s" % fnum(1.0 / len(COMBS) ** 0.5), XC + DX, dev.ctl(2))
    s.wire(d["size"] + ".outs[0]", "reverb_fb.ins[0]")
    s.wire("reverb_fb.outs[0]", "reverb_square.ins[0]")
    s.wire("reverb_square.outs[0]", "reverb_rest.ins[0]")
    s.wire("reverb_rest.outs[0]", "reverb_root.ins[0]")
    s.wire("reverb_root.outs[0]", "reverb_level.ins[0]")
    wet = {}
    half = len(COMBS) // 2
    for ch in ("L", "R"):
        total = s.place("reverb_sum" + ch, "*~ %s" % fnum(reverb_level(fb)), X[ch], dev.sig(half))
        s.wire("reverb_level.outs[0]", total + ".ins[1]")
        for n, ms in enumerate(COMBS):
            # two columns of four, so the section stays a readable height
            x, row = X[ch] + (SUB + 10 if n >= half else 0), n % half
            c = s.place("reverb_comb%s%d" % (ch, n + 1),
                        "comb~ 60 %s 0. 1. %s" % (fnum(ms + SPREAD[ch]), fnum(fb)), x, dev.sig(row))
            s.wire(src[ch], c + ".ins[0]")
            s.wire("reverb_fb.outs[0]", c + ".ins[4]")
            s.wire(c + ".outs[0]", total + ".ins[0]")
        last = total + ".outs[0]"
        for n, ms in enumerate(ALLPASSES):
            ap = s.place("reverb_ap%s%d" % (ch, n + 1), "allpass~ 20 %s 0.5" % fnum(ms + SPREAD[ch]), X[ch], dev.sig(half + 1 + n))
            s.wire(last, ap + ".ins[0]")
            last = ap + ".outs[0]"
        dm = s.place("reverb_damp" + ch, "onepole~ %s" % fnum(val["damp"]), X[ch], dev.sig(half + 1 + len(ALLPASSES)))
        s.wire(last, dm + ".ins[0]")
        s.wire(d["damp"] + ".outs[0]", dm + ".ins[1]")
        wet[ch] = dm + ".outs[0]"
    return dev.mix("reverb", d["mix"], val["mix"], src, wet, half + 2 + len(ALLPASSES), equal_power=True)


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
`,ot=`{
  "version": 2,
  "modules": [
    {
      "id": "filter",
      "label": "Filter",
      "blurb": "State-variable filter (svf~). Park it to shape the tone, or sweep the cutoff by hand.",
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
        { "id": "cutoff", "label": "Cutoff", "min": 40, "max": 10000, "default": 1800, "unit": "Hz", "exponent": 3.0 },
        { "id": "res", "label": "Reso", "min": 0, "max": 100, "default": 30, "unit": "%", "exponent": 1.0 }
      ]
    },
    {
      "id": "drive",
      "label": "Distortion",
      "blurb": "Five kinds of clipping, a tone control after it, and automatic level matching so more drive means more dirt, not more volume.",
      "options": [
        {
          "id": "character",
          "label": "Type",
          "default": "soft",
          "choices": [
            { "id": "soft", "label": "Overdrive" },
            { "id": "tube", "label": "Tube" },
            { "id": "hard", "label": "Hard clip" },
            { "id": "fuzz", "label": "Fuzz" },
            { "id": "fold", "label": "Fold" }
          ]
        }
      ],
      "params": [
        { "id": "amount", "label": "Drive", "min": 1, "max": 10, "default": 3, "unit": "x", "exponent": 1.5 },
        { "id": "tone", "label": "Tone", "min": 400, "max": 10000, "default": 8000, "unit": "Hz", "exponent": 3.0 }
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
      "blurb": "A swept delay line per channel, moving in opposite directions for width. Flanger swaps it for a short comb~ with feedback.",
      "options": [
        {
          "id": "voice",
          "label": "Type",
          "default": "chorus",
          "choices": [
            { "id": "chorus", "label": "Chorus" },
            { "id": "flanger", "label": "Flanger" }
          ]
        }
      ],
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
      "blurb": "Feedback delay on a tapin~ / tapout~ pair. The time glides when you turn it, like tape. Repeats saturate like tape instead of running away. Ping-pong bounces them left and right.",
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
        { "id": "feedback", "label": "Feedback", "short": "Fdbk", "min": 0, "max": 90, "default": 40, "unit": "%", "exponent": 1.0 },
        { "id": "mix", "label": "Mix", "min": 0, "max": 100, "default": 30, "unit": "%", "exponent": 1.0 }
      ]
    },
    {
      "id": "reverb",
      "label": "Reverb",
      "blurb": "Freeverb's layout: eight comb~ filters into four allpass~ stages per channel, level-matched so a long tail is not a loud one.",
      "options": [],
      "params": [
        { "id": "size", "label": "Size", "min": 0, "max": 100, "default": 55, "unit": "%", "exponent": 1.0 },
        { "id": "damp", "label": "Damp", "min": 500, "max": 10000, "default": 6000, "unit": "Hz", "exponent": 3.0 },
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
  "accents": [
    "#ff7a45",
    "#f5c542",
    "#4bd08a",
    "#38bdf8",
    "#a78bfa",
    "#f472b6"
  ]
}
`,it="https://cdn.jsdelivr.net/pyodide/v314.0.3/full/",rt="py/maxpylang-0.1.1-py3-none-any.whl";class lt{constructor(t){this.pending=new Map,this.nextId=1,this.worker=new Worker(new URL("/MaxPyLang/app/assets/pyodide-worker-D1g7dbRn.js",import.meta.url),{type:"module"});let n,s;const a=new Promise((d,r)=>{n=d,s=r});this.worker.onmessage=d=>{const r=d.data;if(r.type==="status")return t(r.message??"");if(r.type==="ready")return n();if(r.type==="error"&&r.phase==="init")return s(new Error(r.message));const l=r.id!==void 0?this.pending.get(r.id):void 0;!l||r.id===void 0||(this.pending.delete(r.id),r.type==="result"?l.resolve(r.json??""):l.reject(new Error(r.message??"Python error")))},this.worker.onerror=d=>s(new Error(d.message||"the Python worker failed to start"));const c=new URL("/MaxPyLang/app/"+rt,location.href).href;this.worker.postMessage({type:"init",pyodideCdn:it,wheelUrl:c}),this.ready=a.then(async()=>{t("loading the generator…"),await this.send({type:"install",dir:"/fxgen",files:{"fxgen.py":at,"schema.json":ot}})}),this.ready.catch(()=>{})}send(t){const n=this.nextId++;return new Promise((s,a)=>{this.pending.set(n,{resolve:s,reject:a}),this.worker.postMessage({...t,id:n})})}async run(t,n=!1){await this.ready;const s=await this.send({type:"call",module:"fxgen",fn:"run_json",args:[JSON.stringify(t),n]});return JSON.parse(s)}}function ct(e){const t=atob(e),n=new Uint8Array(new ArrayBuffer(t.length));for(let s=0;s<t.length;s++)n[s]=t.charCodeAt(s);return n}const i=e=>document.getElementById(e),ke=["piano","guitar","vocals","drums"].map(e=>({id:e,label:e[0].toUpperCase()+e.slice(1),url:`/MaxPyLang/app/samples/fx/${e}.mp3`})),dt={"M4L-01":"A dial’s range, unit and start value cannot be set through edit()","M4L-02":"Presentation mode has no API, and edit() rejects it on some objects","M4L-03":"A comment’s text is saved with the object name in front of it","M4L-04":"Patcher settings (open in presentation, device width) have no API"},ut="https://github.com/Barnard-PL-Labs/MaxPyLang/blob/main/docs/type-system/m4l-gaps.md";let N,x,S=0,Ee="device",z="piano",A,W=[],B=0,f=ht();const L=new Be,g=new He(L.ctx),pt=$e(L.ctx),mt=nt(),X=new lt(e=>P("loading",ft(e.replace(/…$/,""))));function ht(){var s;const e=(s=location.hash.match(/^#s=(.+)$/))==null?void 0:s[1],t=e?st(e):void 0;if(t)return t;const n=Y[0];return N=n.id,n.sample&&(z=n.sample),I(n.settings)}const ft=e=>e&&e[0].toUpperCase()+e.slice(1);function P(e,t){i("status").dataset.state=e,i("status-text").textContent=t,e==="loading"&&(i("boot-text").textContent=t)}let pe=0;function C(e){const t=i("toast");t.textContent=e,t.classList.add("show"),clearTimeout(pe),pe=window.setTimeout(()=>t.classList.remove("show"),2600)}let me=0;function k(e=0){clearTimeout(me),clearTimeout(V),me=window.setTimeout(()=>void gt(),e),Se()}async function gt(){const e=++S;try{if(await X.ready,e!==S)return;P("building","Building");const t=await X.run(f,!1);if(e!==S)return;await pt,await bt(t),P("ready","Python ready")}catch(t){if(e!==S)return;console.error(t),P("error","Build failed"),Q(String(t.message||t))}}async function bt(e){var a;x=e;const t=je(e.json);for(const c of W)c();W=[];const n=await g.duck(()=>L.build(t));for(const c of t.nodes){if(c.maxclass!=="live.dial")continue;const d=mt.get(String(((a=c.raw)==null?void 0:a.varname)??"")),r=n.built.get(c.id);if(!d||!(r!=null&&r.onControlOut))continue;const l=r.onControlOut(0,p=>{const o=Ie(p);o!==void 0&&vt(d.module,d.param,o)});typeof l=="function"&&W.push(l)}B=We(i("device"),e.json,n.built);const s=Ge(i("patch-wrap"),t);i("patch-wrap").dataset.hidden=String(s),te(),i("boot").hidden=!0,i("btn-download").disabled=!1,yt(e),ee(e),Z()}let V=0;function vt(e,t,n){var a;const s=e===w.output.id?f.output:(a=f.chain.find(c=>c.module===e))==null?void 0:a.values;!s||Math.abs((s[t]??NaN)-n)<1e-9||(s[t]=n,T(),Se(),clearTimeout(V),V=window.setTimeout(()=>void wt(),450))}async function wt(){const e=S;try{const t=await X.run(f,!1);if(e!==S)return;x=t,ee(t)}catch(t){console.error(t)}}let he=0;function Se(){clearTimeout(he),he=window.setTimeout(()=>{history.replaceState(null,"",`#s=${_e(f)}`)},300)}function Z(){i("device-title").textContent=f.name;const e=f.chain.filter(n=>n.on).map(n=>{var s;return((s=J(n.module))==null?void 0:s.label)??n.module}),t=i("device-flow");t.replaceChildren();for(const[n,s]of["plugin~",...e,"Output","plugout~"].entries())n&&t.append(Object.assign(document.createElement("i"),{textContent:"→"})),t.append(Object.assign(document.createElement("span"),{textContent:s,className:s.endsWith("~")?"io":""}))}function M(e,t,n=""){const s=document.createElement("div");return s.className=`stat ${n}`,s.append(Object.assign(document.createElement("b"),{textContent:String(e)}),Object.assign(document.createElement("span"),{textContent:t})),s}function yt(e){const t=i("check");t.replaceChildren();const n=e.coverage.cords,s=e.coverage.objects,a=document.createElement("div");a.className="stats",n&&s&&a.append(M(s.total,"objects"),M(n.total,"cords"),M(n.checked,"cords checked",n.checked===n.total?"good":""),M(n.flagged,"flagged",n.flagged?"bad":"good"),M(n.not_checked,"not checked",n.not_checked?"warn":"good")),t.append(a);const c=[];for(const l of e.warnings)c.push(`${l.category}: ${l.message}`);const d=new Map;for(const l of(n==null?void 0:n.not_checked_because)??[]){const[p,o,m]=Array.isArray(l)?l:[String(l),"",1],u=`${String(p).replace(/ \(obj-\d+\)$/,"")}: ${String(o)}`;d.set(u,(d.get(u)??0)+(Number(m)||1))}for(const[l,p]of d)c.push(`not checked, ${p} cord${p===1?"":"s"} from ${l}`);for(const l of(s==null?void 0:s.not_seen_into)??[])c.push(`cannot see into: ${l}`);if(c.length){const l=document.createElement("ul");l.className="check-lines";for(const p of c)l.append(Object.assign(document.createElement("li"),{textContent:p}));t.append(l)}const r=[...new Set([...e.script.matchAll(/gap (M4L-\d+)/g)].map(l=>l[1]))].sort();if(r.length){const l=document.createElement("details");l.className="gaps";const p=document.createElement("summary");p.innerHTML=`<b>${r.length} things this device needs that MaxPyLang cannot say yet.</b> The script works around each one, and each is in the <a href="${ut}" target="_blank" rel="noopener">gap log</a>.`;const o=document.createElement("ul");for(const m of r){const u=document.createElement("li");u.append(Object.assign(document.createElement("code"),{textContent:m}),` ${dt[m]??""}`),o.append(u)}l.append(p,o),t.append(l)}}function Q(e){const t=i("check");t.replaceChildren();const n=document.createElement("pre");n.className="check-error",n.textContent=e,t.append(Object.assign(document.createElement("p"),{textContent:"Python raised an error while building this device:",className:"bad"}),n)}function ee(e){i("code").innerHTML=Ke(e.script);const t=e.script.split(`
`).length;i("py-meta").textContent=`${t} lines · writes ${e.filename}`}function te(){if(!B)return;const t=i("device-wrap").clientWidth-48,n=Math.max(.62,Math.min(2,t/B)),s=i("device");s.style.transform=`scale(${n})`;const a=s.parentElement;a.style.setProperty("--dw",`${B*n}px`),a.style.setProperty("--dh",`${ye*n}px`)}function q(e){Ee=e,i("stage").dataset.view=e,i("view-device").setAttribute("aria-selected",String(e==="device")),i("view-patch").setAttribute("aria-selected",String(e==="patch")),i("device-wrap").hidden=e!=="device",i("patch-wrap").hidden=e!=="patch",e==="device"&&te()}function T(){if(N){N=void 0;for(const e of document.querySelectorAll(".preset.is-active"))e.classList.remove("is-active")}}const Ae=[...new Set(Y.map(e=>e.group))];let $="All";function Le(){const e=i("sections");e.replaceChildren();for(const t of["All",...Ae.filter(n=>n!=="Start")]){const n=document.createElement("button");n.type="button",n.className="section-chip",n.textContent=t,n.setAttribute("role","radio"),n.setAttribute("aria-checked",String(t===$)),n.addEventListener("click",()=>{$=t,Le(),Ce(),i("presets").scrollIntoView({block:"nearest"})}),e.append(n)}}function Ce(){const e=i("presets");e.replaceChildren();for(const t of Ae){if($!=="All"&&$!==t)continue;const n=Y.filter(c=>c.group===t),s=document.createElement("h3");s.append(t,Object.assign(document.createElement("small"),{textContent:String(n.length)})),e.append(s);const a=document.createElement("div");a.className="preset-list";for(const c of n){const d=document.createElement("button");d.type="button",d.className=`preset${c.id===N?" is-active":""}`,d.style.setProperty("--dot",c.settings.accent??w.accents[0]),d.title=c.tag,d.append(Object.assign(document.createElement("b"),{textContent:c.name}),Object.assign(document.createElement("span"),{textContent:c.tag})),d.addEventListener("click",()=>xt(c)),a.append(d)}e.append(a)}}function xt(e){f=I(e.settings),N=e.id,e.sample&&!A&&se(e.sample),Re(),k()}function Te(){const e=i("accents");e.replaceChildren();for(const t of w.accents){const n=document.createElement("button");n.type="button",n.className="accent",n.style.background=t,n.setAttribute("role","radio"),n.setAttribute("aria-checked",String(t===f.accent)),n.setAttribute("aria-label",t),n.addEventListener("click",()=>{f.accent=t,T(),De(),Te(),k()}),e.append(n)}}function De(){document.documentElement.style.setProperty("--accent",f.accent)}let y;function j(){const e=i("chain");e.replaceChildren(),f.chain.forEach((t,n)=>e.append(_t(t,n)))}function _t(e,t){const n=J(e.module),s=document.createElement("li");s.className=`mod${e.on?" is-on":""}`,s.dataset.id=e.module,s.draggable=!0;const a=document.createElement("div");a.className="mod-row";const c=document.createElement("span");c.className="grip",c.title="Drag to reorder",c.innerHTML='<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="3" cy="4" r="1.1"/><circle cx="7" cy="4" r="1.1"/><circle cx="3" cy="8" r="1.1"/><circle cx="7" cy="8" r="1.1"/><circle cx="3" cy="12" r="1.1"/><circle cx="7" cy="12" r="1.1"/></g></svg>';const d=document.createElement("div");d.className="mod-name",d.append(Object.assign(document.createElement("b"),{textContent:n.label}),Object.assign(document.createElement("span"),{textContent:n.params.map(p=>p.label).join(" · ")}));const r=document.createElement("div");r.className="mod-move";for(const[p,o,m]of[[-1,"M3 9l4-4 4 4","Move up"],[1,"M3 5l4 4 4-4","Move down"]]){const u=document.createElement("button");u.type="button",u.title=`${m}: ${n.label}`,u.setAttribute("aria-label",`${m}: ${n.label}`),u.disabled=t+p<0||t+p>=f.chain.length,u.innerHTML=`<svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><path d="${o}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,u.addEventListener("click",()=>fe(e.module,t+p)),r.append(u)}const l=document.createElement("button");if(l.type="button",l.className="switch",l.setAttribute("role","switch"),l.setAttribute("aria-checked",String(e.on)),l.setAttribute("aria-label",`${n.label} on`),l.addEventListener("click",()=>{e.on=!e.on,T(),j(),k()}),a.append(c,d,r,l),s.append(a),e.on){const p=document.createElement("div");p.className="mod-body",n.blurb&&p.append(Object.assign(document.createElement("p"),{textContent:n.blurb}));for(const o of n.options){const m=document.createElement("div");m.className="seg",m.setAttribute("role","radiogroup"),m.setAttribute("aria-label",`${n.label} ${o.label}`);for(const u of o.choices){const h=document.createElement("button");h.type="button",h.textContent=u.label,h.setAttribute("role","radio"),h.setAttribute("aria-checked",String(e.options[o.id]===u.id)),h.addEventListener("click",()=>{e.options[o.id]!==u.id&&(e.options[o.id]=u.id,T(),j(),k())}),m.append(h)}p.append(m)}s.append(p)}return s.addEventListener("dragstart",p=>{var o;y=e.module,s.classList.add("is-dragging"),(o=p.dataTransfer)==null||o.setData("text/plain",e.module),p.dataTransfer&&(p.dataTransfer.effectAllowed="move")}),s.addEventListener("dragend",()=>{y=void 0;for(const p of document.querySelectorAll(".mod"))p.classList.remove("is-dragging","drop-before","drop-after")}),s.addEventListener("dragover",p=>{if(!y||y===e.module)return;p.preventDefault();const o=s.getBoundingClientRect(),m=p.clientY>o.top+o.height/2;s.classList.toggle("drop-before",!m),s.classList.toggle("drop-after",m)}),s.addEventListener("dragleave",()=>s.classList.remove("drop-before","drop-after")),s.addEventListener("drop",p=>{if(!y||y===e.module)return;p.preventDefault();const o=s.classList.contains("drop-after"),m=f.chain.findIndex(h=>h.module===y);let u=f.chain.findIndex(h=>h.module===e.module)+(o?1:0);m<u&&u--,fe(y,u)}),s}function fe(e,t){const n=f.chain.findIndex(a=>a.module===e);if(n<0||t<0||t>=f.chain.length||n===t)return;const[s]=f.chain.splice(n,1);f.chain.splice(t,0,s),T(),j(),k()}function ge(e){for(const t of["presets","build"])i(`tab-${t}`).setAttribute("aria-selected",String(t===e)),i(`pane-${t}`).hidden=t!==e}function Re(){Le(),Ce(),i("name").value=f.name,De(),Te(),j(),Z()}function ne(){var t;const e=i("samples");e.replaceChildren();for(const n of ke){const s=document.createElement("button");s.type="button",s.className="chip",s.textContent=n.label,s.setAttribute("role","radio"),s.setAttribute("aria-checked",String(!A&&n.id===z)),s.addEventListener("click",()=>{A=void 0,i("file-name").textContent="Your audio",se(n.id)}),e.append(s)}(t=document.querySelector(".chip.upload"))==null||t.classList.toggle("is-active",!!A)}async function se(e){z=e,ne();const t=ke.find(n=>n.id===e);if(t)try{const n=await g.load(t);z===e&&!A&&g.setBuffer(n)}catch(n){C(String(n.message||n))}}async function be(e){try{const t=await g.decode(await e.arrayBuffer());A=t,i("file-name").textContent=e.name.length>22?`${e.name.slice(0,20)}…`:e.name,ne(),g.setBuffer(t),g.playing||await K(!0)}catch{C("That file could not be decoded as audio.")}}async function K(e){const t=i("btn-play");e?(await L.start(),g.play(),kt()):(g.stop(),await L.stop()),t.setAttribute("aria-pressed",String(e)),t.setAttribute("aria-label",e?"Stop":"Play"),document.body.classList.toggle("is-playing",e)}let G=!1;function kt(){if(G)return;G=!0;const e=i("scope"),t=e.getContext("2d"),n=new Uint8Array(new ArrayBuffer(g.analyser.frequencyBinCount)),s=i("meter-l"),a=i("meter-r"),c=matchMedia("(prefers-reduced-motion: reduce)").matches;let d=[0,0];const r=()=>{if(!g.playing){G=!1,t.clearRect(0,0,e.width,e.height),s.style.setProperty("--level","0"),a.style.setProperty("--level","0");return}requestAnimationFrame(r);const[l,p]=g.levels();d=[Math.max(l,d[0]*.9),Math.max(p,d[1]*.9)];const o=E=>String(Math.max(0,Math.min(1,1+20*Math.log10(E||1e-6)/48)));if(s.style.setProperty("--level",o(d[0])),a.style.setProperty("--level",o(d[1])),s.classList.toggle("clip",l>=.999),a.classList.toggle("clip",p>=.999),c||Ee!=="device"){t.clearRect(0,0,e.width,e.height);return}const m=Math.min(2,devicePixelRatio||1),u=e.clientWidth,h=e.clientHeight;(e.width!==Math.round(u*m)||e.height!==Math.round(h*m))&&(e.width=Math.round(u*m),e.height=Math.round(h*m)),t.setTransform(m,0,0,m,0,0),t.clearRect(0,0,u,h),g.analyser.getByteFrequencyData(n);const D=L.ctx.sampleRate/2,b=Math.log(40),_=Math.log(16e3),R=96;t.beginPath(),t.moveTo(0,h);for(let E=0;E<=R;E++){const Pe=Math.exp(b+(_-b)*E/R),Ne=Math.min(n.length-1,Math.round(Pe/D*n.length)),ze=h-(n[Ne]/255)**1.5*h*.92;t.lineTo(E/R*u,ze)}t.lineTo(u,h),t.closePath();const H=t.createLinearGradient(0,0,0,h);H.addColorStop(0,`${f.accent}88`),H.addColorStop(1,`${f.accent}00`),t.fillStyle=H,t.fill()};requestAnimationFrame(r)}function Me(e,t,n){const s=URL.createObjectURL(new Blob([e],{type:n})),a=Object.assign(document.createElement("a"),{href:s,download:t});document.body.append(a),a.click(),a.remove(),setTimeout(()=>URL.revokeObjectURL(s),2e3)}async function Et(){const e=i("btn-download");e.disabled=!0,e.classList.add("is-busy");try{const t=await X.run(f,!0);if(!t.amxd)throw new Error("the generator returned no device");Me(ct(t.amxd),t.filename,"application/octet-stream"),x=t,ee(t),C(`Saved ${t.filename}. Drag it onto an audio track in Live.`)}catch(t){console.error(t),C("The download failed. See the type check panel."),Q(String(t.message||t))}finally{e.disabled=!1,e.classList.remove("is-busy")}}function F(e){i("drawer").classList.toggle("open",e),i("drawer").setAttribute("aria-hidden",String(!e)),i("btn-python").setAttribute("aria-expanded",String(e)),i("scrim").hidden=!e,e?i("drawer-close").focus():i("btn-python").focus()}async function ve(e,t){try{await navigator.clipboard.writeText(e),C(t)}catch{C("Copying was blocked by the browser.")}}function St(){Re(),ne(),q("device"),i("name").addEventListener("input",()=>{const e=i("name").value;f.name=I({name:e}).name,T(),Z(),k(450)}),i("name").addEventListener("blur",()=>{i("name").value=f.name}),i("tab-presets").addEventListener("click",()=>ge("presets")),i("tab-build").addEventListener("click",()=>ge("build")),i("view-device").addEventListener("click",()=>q("device")),i("view-patch").addEventListener("click",()=>q("patch")),i("btn-play").addEventListener("click",()=>void K(!g.playing)),i("btn-bypass").addEventListener("click",()=>{g.bypass=!g.bypass,i("btn-bypass").setAttribute("aria-pressed",String(g.bypass)),i("stage").classList.toggle("is-bypassed",g.bypass)}),i("file").addEventListener("change",()=>{var t;const e=(t=i("file").files)==null?void 0:t[0];e&&be(e),i("file").value=""}),window.addEventListener("dragover",e=>{var t;(t=e.dataTransfer)!=null&&t.types.includes("Files")&&e.preventDefault()}),window.addEventListener("drop",e=>{var n,s;const t=(s=(n=e.dataTransfer)==null?void 0:n.files)==null?void 0:s[0];t&&(e.preventDefault(),be(t))}),i("btn-download").addEventListener("click",()=>void Et()),i("btn-python").addEventListener("click",()=>F(!i("drawer").classList.contains("open"))),i("drawer-close").addEventListener("click",()=>F(!1)),i("scrim").addEventListener("click",()=>F(!1)),i("btn-copy").addEventListener("click",()=>{x&&ve(x.script,"Script copied.")}),i("btn-py").addEventListener("click",()=>{x&&Me(x.script,x.filename.replace(/\.amxd$/,".py"),"text/x-python")}),i("btn-share").addEventListener("click",()=>{history.replaceState(null,"",`#s=${_e(f)}`),ve(location.href,"Link copied. It opens this exact device.")}),window.addEventListener("keydown",e=>{e.key==="Escape"&&i("drawer").classList.contains("open")&&F(!1);const t=e.target,n=t.tagName==="INPUT"||t.tagName==="TEXTAREA",s=t.tagName==="BUTTON"||t.getAttribute("role")==="slider";e.code==="Space"&&!n&&!s&&(e.preventDefault(),K(!g.playing))}),new ResizeObserver(()=>te()).observe(i("device-wrap")),X.ready.catch(e=>{P("error","Python failed to start"),i("boot-text").textContent="Python could not start in this browser.",Q(String(e.message||e))}),se(z),k()}St();
