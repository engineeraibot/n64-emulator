const fs=require('fs'),zlib=require('zlib');
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState('state_title_fix', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
// Track distinct color-image targets over time to detect a scene change.
const seen=new Map();
const origFinish = rcp.captureVideoTargetSnapshot ? rcp.captureVideoTargetSnapshot.bind(rcp) : null;
const t0=Date.now();
let pressed=0;
for(let s=0;;s++){
  // clean edge: press START frames, then release. Repeat a few distinct edges.
  if(s===200000){mmu.updateController(0x1000,0,0);pressed++;}
  if(s===600000){mmu.updateController(0,0,0);}
  if(s===1400000){mmu.updateController(0x1000,0,0);pressed++;}
  if(s===1800000){mmu.updateController(0,0,0);}
  if(s===3000000){mmu.updateController(0x1000,0,0);pressed++;}
  if(s===3400000){mmu.updateController(0,0,0);}
  try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
  if((s&0x3FFFF)===0){
    const t=rcp.latestVideoTarget;
    if(t){const k=(t.origin>>>0)+':'+(t.triangles|0)+':'+(t.texRects|0);
      seen.set(k,(seen.get(k)||0)+1);}
    if(Date.now()-t0>40000){realLog('[budget] rel',s);break;}
  }
}
realLog('buttonReads',mmu.controllerDebug.buttonReads,'lastButtons=0x'+(mmu.controllerDebug.lastButtons||0).toString(16),'pressedEdges',pressed);
realLog('f3d',rcp.f3dTaskCount|0);
// dump distinct target signatures (origin:tris:texrects) and counts
const arr=[...seen.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20);
for(const [k,n] of arr) realLog('  tgt',k,'x',n);
