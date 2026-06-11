const {buildMachine}=require('./tmp_boot.js');
const {loadState,saveState}=require('./tmp_state.js');
const M=buildMachine();
loadState(process.env.STATE||'state_title_fix',M.ram,M.mmu,M.cpu,M.rcp);
const c=M.cpu,r=M.rcp,mmu=M.mmu;
const N=parseInt(process.env.N||'80000000');
const PRESS=parseInt(process.env.PRESS||'0',16); // button mask held
if(PRESS) mmu.updateController(PRESS,0,0);
const t0=Date.now();
let lastF3d=-1, originSet=new Set(), lastOrigin=0;
for(let i=0;i<N;i++){
  c.step();
  if((i&0x3FFFFF)===0){
    const vt=r.latestVideoTarget;
    const o=vt?(vt.origin>>>0):0;
    originSet.add(o.toString(16));
    if(r.f3dTaskCount!==lastF3d){lastF3d=r.f3dTaskCount;}
    process.stderr.write(`i=${(i/1e6).toFixed(0)}M f3d=${r.f3dTaskCount} origin=0x${o.toString(16)} btnReads=${mmu.controllerDebug?mmu.controllerDebug.buttonReads:'?'} ch0=${mmu.controllerDebug?mmu.controllerDebug.channel0Cmds:'?'}\n`);
  }
}
console.error('DONE',((Date.now()-t0)/1000).toFixed(1)+'s','f3d='+r.f3dTaskCount,'origins='+[...originSet].join(','));
if(process.env.OUT) saveState(process.env.OUT,M.ram,M.mmu,M.cpu,M.rcp);
