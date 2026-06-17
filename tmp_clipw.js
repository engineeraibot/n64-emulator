const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE, ram, mmu, cpu, rcp);
const log=console.error.bind(console);
const STOP=(rcp.f3dTaskCount|0)+parseInt(process.env.ADV||'3',10);
let auditOn=false;
let clips=0, clipsVaryW=0, maxRatio=1;
const orig=rcp.clipPolygonAgainstAxis.bind(rcp);
rcp.clipPolygonAgainstAxis=function(poly,axis,bound,keepGreater){
  if(auditOn && poly){
    // detect if this clip will actually intersect (some vertex out, some in)
    let anyIn=false,anyOut=false;
    for(const v of poly){const inside=keepGreater?v[axis]>=bound:v[axis]<=bound; if(inside)anyIn=true;else anyOut=true;}
    if(anyIn&&anyOut){
      clips++;
      let wmin=1e9,wmax=-1e9;
      for(const v of poly){const w=Math.abs(v.w??1); if(w<wmin)wmin=w; if(w>wmax)wmax=w;}
      if(wmax/Math.max(wmin,1e-9)>1.0001){clipsVaryW++; if(wmax/wmin>maxRatio)maxRatio=wmax/wmin;}
    }
  }
  return orig(poly,axis,bound,keepGreater);
};
for(let s=0;s<400000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dTaskCount|0;auditOn=(f>=STOP-1);if(f>=STOP)break;}}
log(process.env.STATE,'viewport-clips='+clips,'clipsWithVaryingW='+clipsVaryW,'maxWratio='+maxRatio.toFixed(2));
