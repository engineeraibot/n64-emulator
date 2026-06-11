const {buildMachine}=require('./tmp_boot.js');
const {loadState,saveState}=require('./tmp_state.js');
const M=buildMachine();
loadState(process.env.STATE||'state_title_full',M.ram,M.mmu,M.cpu,M.rcp);
const c=M.cpu,r=M.rcp,mmu=M.mmu;
const N=parseInt(process.env.N||'80000000');
// Press pattern: hold START for HOLD steps, then release. Re-press every CYCLE.
const HOLD=parseInt(process.env.HOLD||'2000000');
const CYCLE=parseInt(process.env.CYCLE||'4000000');
const BTN=parseInt(process.env.BTN||'1000',16);
let lastTex=0,lastUntex=0;
for(let i=0;i<N;i++){
  const phase=i%CYCLE;
  mmu.updateController(phase<HOLD?BTN:0,0,0);
  c.step();
  if((i&0x3FFFFF)===0){
    const vt=r.latestVideoTarget; const o=vt?(vt.origin>>>0):0;
    const tt=r.drawStats.texturedTriangles, ut=r.drawStats.untexturedTriangles;
    process.stderr.write(`i=${(i/1e6).toFixed(0)}M f3d=${r.f3dTaskCount} o=0x${o.toString(16)} dTex=${tt-lastTex} dUntex=${ut-lastUntex} btnReads=${mmu.controllerDebug.buttonReads} lastBtn=0x${(mmu.controllerDebug.lastButtons||0).toString(16)}\n`);
    lastTex=tt;lastUntex=ut;
  }
}
if(process.env.OUT) saveState(process.env.OUT,M.ram,M.mmu,M.cpu,M.rcp);
