const {buildMachine}=require('./tmp_boot');
const {loadState,saveState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const IN=process.env.IN||'state_title_fix', OUT=process.env.OUT||'state_chain1';
const SECS=parseInt(process.env.SECS||'36',10);
loadState(IN, ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
mmu.updateController(0x1000,0,0);
const origins=new Map(); // origin -> first rel-step seen
const t0=Date.now(); let s=0;
for(;;s++){
  try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
  if((s&0xFFF)===0){
    const o=rcp.latestVideoTarget&&rcp.latestVideoTarget.origin;
    if(o!==undefined&&!origins.has(o)){origins.set(o,s);realLog('NEW ORIGIN 0x'+(o>>>0).toString(16),'at rel',s,'f3d',rcp.f3dTaskCount|0);}
  }
  if((s&0x1FFFF)===0){
    mmu.updateController(0x1000,0,0);
    if(Date.now()-t0>SECS*1000)break;
  }
}
saveState(OUT, ram, mmu, cpu, rcp);
realLog('SAVED',OUT,'rel-steps',s,'f3d',rcp.f3dTaskCount|0,'origins',[...origins.keys()].map(x=>'0x'+(x>>>0).toString(16)).join(','));
