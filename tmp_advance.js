const {buildMachine}=require('./tmp_boot');
const {loadState,saveState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const IN=process.env.IN||'state_f3d96', OUT=process.env.OUT||'state_adv';
loadState(IN, ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
const PRESS=process.env.PRESS==='1';const PRESS_AT=parseInt(process.env.PRESS_AT||'0',10);
const t0=Date.now();let lastReport=t0;let firstCh0=-1;
let s=0;
for(;;s++){
  if(PRESS && s===PRESS_AT){mmu.updateController(0x1000,0,0);}
  try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
  if(firstCh0<0 && mmu.controllerDebug.channel0Cmds>0){firstCh0=s;realLog('*** CH0 POLL began at rel-step',s,'***');}
  if((s&0x1FFFF)===0){const now=Date.now();
    if(now-lastReport>6000){realLog('rel',s,'f3d',rcp.f3dTaskCount|0,'rsp',rcp.rspTaskCount|0,'pc=0x'+(cpu.pc>>>0).toString(16),'ch0',mmu.controllerDebug.channel0Cmds);lastReport=now;}
    if(now-t0>38000)break;}
}
saveState(OUT, ram, mmu, cpu, rcp);
realLog('SAVED',OUT,'after rel-steps',s,'f3d',rcp.f3dTaskCount|0,'ch0',mmu.controllerDebug.channel0Cmds,'btn',mmu.controllerDebug.buttonReads,'firstCh0',firstCh0);
