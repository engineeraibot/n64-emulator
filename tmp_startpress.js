const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState('state_title_fix', ram, mmu, cpu, rcp);
const t0=Date.now();
mmu.controllerDebug.buttonReads=0;
let pressed=false, baselineF3d=rcp.f3dTaskCount|0;
let origins=new Map();
const PRESS_AT=parseInt(process.env.PRESS_AT||'500000',10);
for(let s=0;;s++){
  if(!pressed && s>=PRESS_AT){ mmu.updateController(0x1000,0,0); pressed=true; } // hold START
  try{cpu.step();}catch(e){console.error('THREW',s,e.message);break;}
  if((s&0x3FFFF)===0){
    const snap=rcp.bestRichVideoSnapshot;
    if(snap) origins.set(snap.origin>>>0,(origins.get(snap.origin>>>0)||0)+1);
    if(Date.now()-t0>38000){console.error('budget rel',s);break;}
  }
}
console.error('buttonReads(after press window)=',mmu.controllerDebug.buttonReads,'lastButtons=0x'+(mmu.controllerDebug.lastButtons||0).toString(16));
console.error('f3d baseline=',baselineF3d,'now=',rcp.f3dTaskCount|0);
