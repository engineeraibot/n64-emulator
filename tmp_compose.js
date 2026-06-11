const {buildMachine}=require('./tmp_boot.js');
const {loadState,saveState}=require('./tmp_state.js');
const M=buildMachine();
loadState(process.env.STATE||'state_title_fix',M.ram,M.mmu,M.cpu,M.rcp);
const c=M.cpu,r=M.rcp,mmu=M.mmu;
const TARGET=parseInt(process.env.TARGET||'96');
const N=parseInt(process.env.N||'200000000');
const OUT=process.env.OUT||'state_title_full';
for(let i=0;i<N;i++){
  c.step();
  if((i&0x7FFFFF)===0 && i>0){ saveState(OUT,M.ram,M.mmu,M.cpu,M.rcp); process.stderr.write('save i='+(i/1e6).toFixed(0)+'M f3d='+r.f3dTaskCount+'\n'); }
  if(r.f3dTaskCount>=TARGET) break;
}
saveState(OUT,M.ram,M.mmu,M.cpu,M.rcp);
console.error('FINAL f3d='+r.f3dTaskCount);
