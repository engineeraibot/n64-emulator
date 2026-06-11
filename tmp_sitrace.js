const {buildMachine}=require('./tmp_boot.js');
const {ram,mmu,rcp,cpu}=buildMachine();
const MAX=parseInt(process.env.STEPS||'40000000',10);
const hex=a=>Array.from(a).map(b=>b.toString(16).padStart(2,'0')).join(' ');
let n=0;
const origToPif=mmu.doSiDma.bind(mmu);
mmu.doSiDma=function(toPif){
  if(toPif){ n++; if(n<=50){ console.error(`#${n} WRITE->PIF instr=${cpu.instructionCount} pif[0:32]=${hex(mmu.pifRam.slice(0,32))}`);} }
  return origToPif(toPif);
};
for(let s=0;s<MAX;s++){ cpu.step(); if(n>=50)break; }
console.error('done total WRITE->PIF=',n,'instr=',cpu.instructionCount,'f3d=',rcp.f3dTaskCount);
console.error('channel0Cmds=',mmu.controllerDebug.channel0Cmds,'infoReads=',mmu.controllerDebug.infoReads,'buttonReads=',mmu.controllerDebug.buttonReads);
