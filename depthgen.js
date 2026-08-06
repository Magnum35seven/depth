/* depthgen.js — port of the proven Python algorithm (depthgen.py) into the PWA.
   Smooth, shaded depth map from line art, with per-region shading and automatic
   page-margin vs full-bleed detection. Exposes window.__renderDepthGen. */

(function(){
"use strict";

/* ---------------- generic image helpers (standalone copies) ---------------- */

// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher). mask=1 => seed.
function edt1d(f,d,v,z,n){
  let k=0; v[0]=0; z[0]=-Infinity; z[1]=Infinity;
  for(let q=1;q<n;q++){
    let s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]);
    while(s<=z[k]){k--;s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]);}
    k++; v[k]=q; z[k]=s; z[k+1]=Infinity;
  }
  k=0;
  for(let q=0;q<n;q++){ while(z[k+1]<q)k++; const dd=q-v[k]; d[q]=dd*dd+f[v[k]]; }
}
function edt(mask,w,h){
  const INF=1e12, g=new Float64Array(w*h);
  for(let i=0;i<g.length;i++) g[i]=mask[i]?0:INF;
  const n=Math.max(w,h), f=new Float64Array(n), d=new Float64Array(n),
        v=new Int32Array(n), z=new Float64Array(n+1);
  for(let x=0;x<w;x++){ for(let y=0;y<h;y++) f[y]=g[y*w+x];
    edt1d(f,d,v,z,h); for(let y=0;y<h;y++) g[y*w+x]=d[y]; }
  for(let y=0;y<h;y++){ const o=y*w; for(let x=0;x<w;x++) f[x]=g[o+x];
    edt1d(f,d,v,z,w); for(let x=0;x<w;x++) g[o+x]=Math.sqrt(d[x]); }
  return g;
}

// separable box blur x3 ~ gaussian
function blur(a,w,h,r){
  if(r<1) return a;
  let cur=a;
  for(let pass=0;pass<3;pass++){
    const t=new Float32Array(w*h);
    for(let y=0;y<h;y++){ const o=y*w; let acc=0;
      for(let x=-r;x<=r;x++) acc+=cur[o+Math.min(w-1,Math.max(0,x))];
      for(let x=0;x<w;x++){ t[o+x]=acc/(2*r+1);
        acc+=cur[o+Math.min(w-1,x+r+1)]-cur[o+Math.min(w-1,Math.max(0,x-r))]; } }
    const t2=new Float32Array(w*h);
    for(let x=0;x<w;x++){ let acc=0;
      for(let y=-r;y<=r;y++) acc+=t[Math.min(h-1,Math.max(0,y))*w+x];
      for(let y=0;y<h;y++){ t2[y*w+x]=acc/(2*r+1);
        acc+=t[Math.min(h-1,y+r+1)*w+x]-t[Math.min(h-1,Math.max(0,y-r))*w+x]; } }
    cur=t2;
  }
  return cur;
}

// flood fill from border through `valid` mask. Returns Uint8Array reached.
function floodBorder(valid,w,h){
  const out=new Uint8Array(w*h);
  const st=new Int32Array(w*h); let sp=0;
  const push=i=>{ if(valid[i]&&!out[i]){out[i]=1;st[sp++]=i;} };
  for(let x=0;x<w;x++){push(x);push((h-1)*w+x);}
  for(let y=0;y<h;y++){push(y*w);push(y*w+w-1);}
  while(sp){ const i=st[--sp], x=i%w, y=(i/w)|0;
    if(x>0)push(i-1); if(x<w-1)push(i+1); if(y>0)push(i-w); if(y<h-1)push(i+w); }
  return out;
}

// connected components of a binary mask (4-connected). Returns {lab, n}.
function label(mask,w,h){
  const lab=new Int32Array(w*h).fill(-1); let n=0;
  const st=new Int32Array(w*h);
  for(let s0=0;s0<w*h;s0++){
    if(!mask[s0]||lab[s0]>=0)continue;
    const id=n++, sp0=0; st[sp0]=s0; lab[s0]=id; let sp=1;
    while(sp){ const i=st[--sp], x=i%w, y=(i/w)|0;
      if(x>0&&mask[i-1]&&lab[i-1]<0){lab[i-1]=id;st[sp++]=i-1;}
      if(x<w-1&&mask[i+1]&&lab[i+1]<0){lab[i+1]=id;st[sp++]=i+1;}
      if(y>0&&mask[i-w]&&lab[i-w]<0){lab[i-w]=id;st[sp++]=i-w;}
      if(y<h-1&&mask[i+w]&&lab[i+w]<0){lab[i+w]=id;st[sp++]=i+w;}
    }
  }
  return {lab,n};
}

// binary dilation (4-connect, it iterations) — returns Uint8Array
function dilate(mask,w,h,it){
  let cur=Uint8Array.from(mask);
  for(let k=0;k<it;k++){
    const nx=new Uint8Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){ const i=y*w+x;
      if(cur[i]){ nx[i]=1;
        if(x>0)nx[i-1]=1; if(x<w-1)nx[i+1]=1; if(y>0)nx[i-w]=1; if(y<h-1)nx[i+w]=1; }
    }
    cur=nx;
  }
  return cur;
}

// simple bilateral-ish smooth: box blur weighted by value closeness
function bilateral(a,w,h,r,sigR){
  if(r<1) return a;
  const out=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x, c=a[i]; let sum=0, wsum=0;
    for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
      const nx=x+dx, ny=y+dy;
      if(nx<0||ny<0||nx>=w||ny>=h)continue;
      const v=a[ny*w+nx], wgt=Math.exp(-((v-c)*(v-c))/(sigR*sigR));
      sum+=v*wgt; wsum+=wgt;
    }
    out[i]=wsum? sum/wsum : c;
  }
  return out;
}

/* ---------------- detection ---------------- */
function detectMode(gray,thr){
  const w=gray.w, h=gray.h, N=w*h;
  const g=gray.gray;
  const ink=new Uint8Array(N);
  for(let i=0;i<N;i++) ink[i]= g[i]<thr?1:0;
  const white=new Uint8Array(N);
  for(let i=0;i<N;i++) white[i]= ink[i]?0:1;
  const page=floodBorder(white,w,h);
  let inkf=0, encN=0, whiteN=0;
  for(let i=0;i<N;i++){ if(ink[i])inkf++; if(white[i])whiteN++; if(white[i]&&!page[i])encN++; }
  inkf/=N; whiteN=Math.max(whiteN,1);
  const encf=encN/whiteN;
  // dominance of largest page component
  const {lab,n}=label(page,w,h);
  let dom=0, sum=0;
  if(n>0){
    const cnt=new Float64Array(n);
    for(let i=0;i<N;i++) if(lab[i]>=0) cnt[lab[i]]++;
    let mx=0; for(let k=0;k<n;k++){ mx=Math.max(mx,cnt[k]); sum+=cnt[k]; }
    dom=sum? mx/sum : 0;
  }
  const fullBleed = (encf<0.22 && dom>0.7);
  return {fullBleed, inkf, encf};
}

/* ---------------- page-margin relief ---------------- */
function pageRelief(gray,thr,gamma,top,bg,levels){
  // Winning approach (user-approved): raised white forms, light internal lines,
  // dark outer margin only.
  const w=gray.w, h=gray.h, N=w*h;
  const g=gray.gray;
  const ink=new Uint8Array(N);
  for(let i=0;i<N;i++) ink[i]= g[i]<thr?1:0;
  const white=new Uint8Array(N);
  for(let i=0;i<N;i++) white[i]= ink[i]?0:1;

  // true outer background = large open border-connected margin
  const page=floodBorder(white,w,h);
  const lab_page=label(page,w,h).lab;
  const nbg=lab_page.length? 0:0;
  // find largest page component
  let maxIdx=-1, maxSize=0;
  {
    const cnt=new Float64Array(w*h);
    let nc=0;
    for(let i=0;i<N;i++) if(lab_page[i]>=0){ if(lab_page[i]>=cnt.length)continue; cnt[lab_page[i]]++; }
    // need actual n; recompute max
    let bigSize=0, bigId=-1;
    const seen=new Set();
    for(let i=0;i<N;i++){ const id=lab_page[i]; if(id<0||seen.has(id))continue; seen.add(id);
      if(cnt[id]>bigSize){bigSize=cnt[id];bigId=id;} }
    maxIdx=bigId; maxSize=bigSize;
  }
  const outer=new Uint8Array(N);
  for(let i=0;i<N;i++) if(lab_page[i]===maxIdx) outer[i]=1;
  const internal=new Uint8Array(N);
  for(let i=0;i<N;i++) internal[i]= outer[i]?0:1;

  // raise each enclosed white form as a smooth dome (distance-to-ink, per-region normalized)
  const dist=edt(ink,w,h);   // distance to nearest ink
  const {lab,n:ncomp}=label(white,w,h);
  const petal=new Float32Array(N);
  for(let id=0;id<ncomp;id++){
    let dmax_i=0, cnt=0;
    for(let i=0;i<N;i++) if(lab[i]===id){ cnt++; if(dist[i]>dmax_i) dmax_i=dist[i]; }
    if(cnt<3) continue;
    dmax_i+=1e-6;
    for(let i=0;i<N;i++) if(lab[i]===id) petal[i]=dist[i]/dmax_i;
  }
  for(let i=0;i<N;i++) petal[i]=Math.pow(Math.max(0,petal[i]),0.5);
  // normalize 0..1
  let pmin=1e9, pmax=-1e9;
  for(let i=0;i<N;i++){ if(petal[i]<pmin)pmin=petal[i]; if(petal[i]>pmax)pmax=petal[i]; }
  const pr=pmax-pmin+1e-6;
  for(let i=0;i<N;i++) petal[i]=(petal[i]-pmin)/pr;
  for(let i=0;i<N;i++) petal[i]=(1-top)+top*petal[i];   // map into [1-top, 1]

  // fill internal lines so they are LIGHT (no dark outline)
  const filled=blur(petal,w,h,2);
  for(let i=0;i<N;i++) if(ink[i]) petal[i]=filled[i];

  // final: petals+lines light, outer margin dark
  const out=new Float32Array(N);
  for(let i=0;i<N;i++) out[i]= internal[i]? petal[i] : bg;
  const o2=blur(out,w,h,1);
  for(let i=0;i<N;i++){ if(internal[i]) out[i]=petal[i]; else out[i]=bg; }
  const o3=blur(out,w,h,1);
  for(let i=0;i<N;i++) out[i]=Math.max(0,Math.min(1,o3[i]));
  // optional discrete depth levels (AdaBins-inspired): quantise internal relief
  if(levels>1){
    let lo=1e9, hi=-1e9;
    for(let i=0;i<N;i++){ if(!internal[i])continue; if(out[i]<lo)lo=out[i]; if(out[i]>hi)hi=out[i]; }
    const span=(hi-lo)+1e-6;
    for(let i=0;i<N;i++){
      if(!internal[i])continue;
      const f=(out[i]-lo)/span;
      const q=Math.min(levels-1, Math.floor(f*levels));
      out[i]=lo + (q/Math.max(levels-1,1))*span;
    }
    const o4=blur(out,w,h,Math.max(1,Math.round(1)));
    for(let i=0;i<N;i++) out[i]=Math.max(0,Math.min(1,o4[i]));
  }
  // outside mask for rendering (true outer background)
  const outside=new Uint8Array(N);
  for(let i=0;i<N;i++) outside[i]= outer[i];
  return {ht:out,outside:outside};
}

/* ---------------- full-bleed relief ---------------- */
function fullbleedRelief(gray,thr,sm,gamma,top){
  const w=gray.w, h=gray.h, N=w*h;
  const g=gray.gray;
  const ink=new Uint8Array(N);
  for(let i=0;i<N;i++) ink[i]= g[i]<thr?1:0;
  const white=new Uint8Array(N);
  for(let i=0;i<N;i++) white[i]= ink[i]?0:1;
  const dist=edt(ink,w,h);
  let dmax=0; for(let i=0;i<N;i++) dmax=Math.max(dmax,dist[i]);
  dmax+=1e-6;
  const elev=new Float32Array(N);
  for(let i=0;i<N;i++) elev[i]=Math.min(1,dist[i]/dmax);
  let e=blur(elev,w,h,Math.max(1,Math.round(sm)));
  for(let i=0;i<N;i++) e[i]=Math.pow(Math.max(0,e[i]),gamma);
  let mMax=0; for(let i=0;i<N;i++) if(e[i]>0) mMax=Math.max(mMax,e[i]);
  if(mMax>0) for(let i=0;i<N;i++) if(e[i]>0) e[i]=top*e[i]/mMax;
  e=bilateral(e,w,h,3,0.25);
  for(let i=0;i<N;i++) e[i]=Math.max(0,Math.min(1,e[i]));
  // outside = none (full bleed) for consistency
  const outside=new Uint8Array(N);
  return {ht:e,outside};
}

/* ---------------- main entry ---------------- */
function render(gray,thr,gamma,top,bg,levels,mode){
  let fb;
  if(mode==='auto') fb=detectMode(gray,thr).fullBleed;
  else fb=(mode==='fullbleed');
  if(fb) return fullbleedRelief(gray,thr,0.5,0.5,top);
  return pageRelief(gray,thr,gamma,top,bg,levels);
}

window.__renderDepthGen = render;
})();
