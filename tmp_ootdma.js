process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState(process.env.INSTATE||'state_oot_n64logo',ram,mmu,cpu,rcp);
const PRESSAT=process.env.PRESSAT?parseInt(process.env.PRESSAT):-1;
const startF=rcp.f3dex2TaskCount|0;
let bs=0;const t0=Date.now();
let lastDma=mmu._totalPiDmaCount|0, lastF=startF;
for(let s=0;s<500000000;s++){
  try{cpu.step();}catch(e){log('THREW',s,e.message);break;}
  if((s&0x3FFF)===0){
    const f=rcp.f3dex2TaskCount|0;
    if(PRESSAT>=0){const ph=(f-startF)%60;let w=(ph>=PRESSAT&&ph<PRESSAT+8)?0x1000:0;if(w!==bs){mmu.updateController(w,0,0);bs=w;}}
    if(f-lastF>=40){log('f3dex2',f,'totalPiDma',mmu._totalPiDmaCount|0,'(+'+((mmu._totalPiDmaCount|0)-lastDma)+')','btnReads',mmu.controllerDebug.buttonReads,'lastBtns0x'+(mmu.controllerDebug.lastButtons||0).toString(16));lastDma=mmu._totalPiDmaCount|0;lastF=f;}
    if(Date.now()-t0>30000){log('[budget] step',s,'f3dex2',f);break;}
  }
}
log('END totalPiDma',mmu._totalPiDmaCount|0,'btnReads',mmu.controllerDebug.buttonReads,'pifCmdCalls',mmu.controllerDebug.pifCmdCalls);
