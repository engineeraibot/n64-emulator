const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_f3d96', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
const PRESS=process.env.PRESS==='1';
const t0=Date.now();let maxF3d=0;let lastReport=t0;
for(let s=0;;s++){
  if(PRESS && s===3000000){mmu.updateController(0x1000,0,0);}
  try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
  if((s&0x1FFFF)===0){
    const f=rcp.f3dTaskCount|0; if(f>maxF3d)maxF3d=f;
    const now=Date.now();
    if(now-lastReport>5000){realLog('rel',s,'newF3d',f,'rsp',rcp.rspTaskCount|0,'pc=0x'+(cpu.pc>>>0).toString(16),'ch0',mmu.controllerDebug.channel0Cmds);lastReport=now;}
    if(now-t0>40000){realLog('[budget] rel',s);break;}
  }
}
realLog('FINAL newF3d',maxF3d,'rsp',rcp.rspTaskCount|0,'ch0',mmu.controllerDebug.channel0Cmds,'btn',mmu.controllerDebug.buttonReads);
