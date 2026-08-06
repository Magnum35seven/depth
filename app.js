/* Line2Relief v38 — focused depth-map generator.
   Core engine is the DepthGen algorithm (depthgen.js): a smooth, shaded depth
   map from line art, with per-region shading and automatic page/full-bleed
   detection. Minimal UI. */

const $ = s => document.querySelector(s);
const cv = $('#out'), ctx = cv.getContext('2d');
let src = null;                 // {w,h,gray:Float32Array}
let timer = null;
let blackMask = null;           // Uint8Array, user-painted areas forced to black
let fillMode = false;

const P = {
  thr:.62, gamma:.50, top:.60, bg:.08, levels:0, mode:'auto',
  invert:false, cut:true
};
const DEF = {...P};

const PRESETS = {
  // DepthGen (default): crisp edges, smooth-shaded interior
  depthgen:{thr:.62, gamma:.50, top:.60, bg:.08, levels:0, mode:'auto'},
  // Smooth: softer, more flowing
  smooth:{thr:.62, gamma:.55, top:.70, bg:.10, levels:0, mode:'auto'},
  // Crisp: sharp detail, light shading
  crisp:{thr:.62, gamma:.45, top:.50, bg:.06, levels:0, mode:'auto'}
};

/* ---------------- UI wiring ---------------- */
const binds = [
  ['s-thr','thr','v-thr',v=>v.toFixed(2)], ['s-gamma','gamma','v-gamma',v=>v.toFixed(2)],
  ['s-top','top','v-top',v=>v.toFixed(2)], ['s-bg','bg','v-bg',v=>v.toFixed(2)], ['s-levels','levels','v-levels',v=>v|0]
];
binds.forEach(([id,key,out,fmt])=>{
  const el=$('#'+id);
  el.addEventListener('input',()=>{P[key]=parseFloat(el.value);$('#'+out).textContent=fmt(P[key]);schedule();});
});
$('#c-inv').addEventListener('change',e=>{P.invert=e.target.checked;schedule();});
$('#c-cut').addEventListener('change',e=>{P.cut=e.target.checked;schedule();});

function chips(sel,key){
  const box=$(sel);
  box.addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b)return;
    [...box.children].forEach(c=>c.classList.toggle('on',c===b));
    key(b.dataset);
  });
}
chips('#presets',d=>{Object.assign(P,PRESETS[d.p]);syncUI();schedule();});
$('#reset').addEventListener('click',()=>{Object.assign(P,DEF);syncUI();schedule();});

function syncUI(){
  binds.forEach(([id,key,out,fmt])=>{$('#'+id).value=P[key];$('#'+out).textContent=fmt(P[key]);});
  $('#c-inv').checked=P.invert; $('#c-cut').checked=P.cut;
}

/* ---------------- file input ---------------- */
const drop=$('#drop'), fileIn=$('#file');
fileIn.addEventListener('change',e=>e.target.files[0]&&load(e.target.files[0]));
const openPicker=()=>fileIn.click();
$('#pick').addEventListener('click',openPicker);
$('#pick2').addEventListener('click',openPicker);
$('#demo').addEventListener('click',async()=>{
  try{ const r=await fetch('sample.png'); if(!r.ok)throw 0; load(await r.blob()); }
  catch{ alert('Sample not found — serve the folder over http (python3 -m http.server).'); }
});
['dragenter','dragover'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.add('hot');}));
['dragleave','drop'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.remove('hot');}));
drop.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f)load(f);});
addEventListener('paste',e=>{const it=[...(e.clipboardData?.files||[])][0];if(it)load(it);});

async function load(file){
  let bmp;
  try{ bmp = await createImageBitmap(file); }
  catch(err){ alert('Could not read that file as an image.'); return; }
  const MAX = 1400;
  const s = Math.min(1, MAX/Math.max(bmp.width,bmp.height));
  const w = Math.max(1,Math.round(bmp.width*s)), h = Math.max(1,Math.round(bmp.height*s));
  const c = document.createElement('canvas'); c.width=w; c.height=h;
  const cx = c.getContext('2d',{willReadFrequently:true});
  cx.fillStyle='#fff'; cx.fillRect(0,0,w,h);
  cx.drawImage(bmp,0,0,w,h);
  const d = cx.getImageData(0,0,w,h).data;
  const gray = new Float32Array(w*h);
  for(let i=0,p=0;i<gray.length;i++,p+=4)
    gray[i]=(0.299*d[p]+0.587*d[p+1]+0.114*d[p+2])/255;
  src={w,h,gray};
  drop.hidden=true; $('#wrap').hidden=false; $('#download').disabled=false; $('#fill').disabled=false; $('#fillclear').disabled=false;
  schedule(0);
}

function busy(on){ $('#busy').hidden=!on; }
function schedule(ms=90){
  if(!src)return;
  clearTimeout(timer); busy(true);
  timer=setTimeout(()=>{ requestAnimationFrame(()=>{
    try{ render(); }
    catch(err){ console.error('render failed',err); alert('Render failed: '+err.message); }
    finally{ busy(false); }
  }); }, ms);
}

function render(){
  const {w,h,gray}=src, N=w*h;
  if(!window.__renderDepthGen){ alert('DepthGen engine not loaded.'); return; }
  // invert if requested
  let g=gray;
  if(P.invert){
    g=new Float32Array(N); for(let i=0;i<N;i++) g[i]=1-gray[i];
  }
  const R=window.__renderDepthGen({gray:g, w, h}, P.thr, P.gamma, P.top, P.bg, P.levels, P.mode);
  const {ht, outside}=R;
  cv.width=w; cv.height=h;
  const img=ctx.createImageData(w,h), o=img.data;
  // blackMask: user-painted areas forced to black (background fill tool)
  const mask=blackMask && blackMask.length===N ? blackMask : null;
  for(let i=0,p=0;i<N;i++,p+=4){
    const v= (mask&&mask[i]) ? 0 : ht[i];
    const c=(Math.max(0,Math.min(1,v))*255)|0;
    o[p]=o[p+1]=o[p+2]=c; o[p+3]=255;
  }
  ctx.putImageData(img,0,0);
  window.__relief={ht:ht,w:w,h:h,outside:outside};
}

/* ---------------- download ---------------- */
function canvasBlob(){ return new Promise(r=>cv.toBlob(r,'image/png')); }
function inRestrictedFrame(){
  if(window.top===window.self) return false;
  try{ return !window.top.location.href; }catch(e){ return true; }
}
function toast(msg){
  let t=document.getElementById('toast');
  if(!t){ t=document.createElement('div'); t.id='toast'; document.body.appendChild(t); }
  t.textContent=msg; t.classList.add('on');
  clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('on'),2200);
}
function showSaveOverlay(dataURL){
  let ov=document.getElementById('saveov');
  if(!ov){
    ov=document.createElement('div'); ov.id='saveov';
    ov.innerHTML='<p>Long-press (or right-click) the image below and choose <b>Save image</b>.</p>'+
                 '<img alt="relief result"><button>Close</button>';
    document.body.appendChild(ov);
    ov.querySelector('button').onclick=()=>ov.classList.remove('on');
  }
  ov.querySelector('img').src=dataURL; ov.classList.add('on');
}
async function savePNG(){
  const blob=await canvasBlob();
  if(!blob){ alert('Could not read the canvas.'); return; }
  const name='relief-'+Date.now()+'.png';
  if(inRestrictedFrame()){
    if(navigator.canShare && navigator.canShare({files:[new File([blob],name,{type:'image/png'})]})){
      try{ await navigator.share({files:[new File([blob],name,{type:'image/png'})],title:'Relief'}); return; }catch(e){ if(e.name==='AbortError') return; }
    }
    showSaveOverlay(cv.toDataURL('image/png')); return;
  }
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=name; a.rel='noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
  toast('Saved '+name);
}
$('#download').addEventListener('click',savePNG);

/* ---------------- black fill tool ---------------- */
function paintAt(ev){
  if(!src||!blackMask) return;
  const r=cv.getBoundingClientRect();
  const t=ev.touches?ev.touches[0]:ev;
  const x=Math.floor((t.clientX-r.left)/r.width*src.w);
  const y=Math.floor((t.clientY-r.top )/r.height*src.h);
  if(x<0||y<0||x>=src.w||y>=src.h) return;
  const brush=Math.max(1,Math.round(src.w*0.02)); // ~2% brush radius
  for(let dy=-brush;dy<=brush;dy++)for(let dx=-brush;dx<=brush;dx++){
    if(dx*dx+dy*dy>brush*brush)continue;
    const nx=x+dx, ny=y+dy;
    if(nx<0||ny<0||nx>=src.w||ny>=src.h)continue;
    blackMask[ny*src.w+nx]=1;
  }
  schedule(0);
}
$('#fill').addEventListener('click',()=>{
  fillMode=!fillMode;
  if(fillMode){
    blackMask=new Uint8Array(src?src.w*src.h:0);
    cv.style.cursor='crosshair';
    toast('Black fill ON — drag to paint areas black. Click again to finish.');
  }else{
    cv.style.cursor='';
    toast('Black fill applied');
  }
  $('#fill').classList.toggle('on',fillMode);
});
cv.addEventListener('mousedown',e=>{ if(fillMode)paintAt(e); });
addEventListener('mousemove',e=>{ if(fillMode&&e.buttons&1)paintAt(e); });
cv.addEventListener('touchstart',e=>{ if(fillMode){paintAt(e);e.preventDefault();} },{passive:false});
cv.addEventListener('touchmove',e=>{ if(fillMode){paintAt(e);e.preventDefault();} },{passive:false});
$('#fillclear').addEventListener('click',()=>{ blackMask=null; toast('Black fill cleared'); schedule(0); });

let deferred;
addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;$('#install').hidden=false;});
$('#install').addEventListener('click',async()=>{ if(!deferred)return; deferred.prompt(); await deferred.userChoice; deferred=null; $('#install').hidden=true; });
syncUI();
