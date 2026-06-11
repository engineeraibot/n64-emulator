const {buildMachine}=require('./tmp_boot');
const {loadState,saveState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const IN=process.env.IN||'state_chain2', OUT=process.env.OUT||'state_toggle1';
const SECS=parseInt(process.env.SECS||'36',10);
const PERIOD=parseInt(process.env.PERIOD||'1500000',10); // steps per half-cycle
loadState(IN, ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
const origins=new Map();
const t0=Date.now(); let s=0; let cur=-1;
for(;;s++){
  const want=(Math.floor(s/PERIOD)&1)?0x1000:0;
  if(want!==cur){cur=want;mmu.updateController(cur,0,0);}
  try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
  if((s&0xFFF)===0){
    const o=rcp.latestVideoTarget&&rcp.latestVideoTarget.origin;
    if(o!==undefined&&!origins.has(o)){origins.set(o,s);realLog('NEW ORIGIN 0x'+(o>>>0).toString(16),'at rel',s,'f3d',rcp.f3dTaskCount|0);}
  }
  if((s&0x1FFFF)===0 && Date.now()-t0>SECS*1000)break;
}
saveState(OUT, ram, mmu, cpu, rcp);
realLog('SAVED',OUT,'rel-steps',s,'f3d',rcp.f3dTaskCount|0);
