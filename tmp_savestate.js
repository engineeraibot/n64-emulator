const {buildMachine}=require('./tmp_boot');
const {saveState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const realLog=console.log.bind(console);
const BUDGET=parseInt(process.env.BUDGET_MS||'42000',10);
const OUT=process.env.OUT||'state_f3d96';
const t0=Date.now();let saved=false;
for(let s=0;;s++){
  try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
  if(!saved && (rcp.f3dTaskCount|0)>=96){
    saveState(OUT, ram, mmu, cpu, rcp);
    realLog('SAVED at step',s,'f3d',rcp.f3dTaskCount|0,'t',(Date.now()-t0)/1000);
    saved=true; break;
  }
  if((s&0xFFFF)===0 && Date.now()-t0>BUDGET){realLog('budget, f3d',rcp.f3dTaskCount|0,'step',s);break;}
}
realLog('done saved='+saved);
