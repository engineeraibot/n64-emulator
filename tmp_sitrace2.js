const {buildMachine}=require('./tmp_boot.js');
const {ram,mmu,rcp,cpu}=buildMachine();
const MAX=parseInt(process.env.STEPS||'60000000',10);
const hex=a=>Array.from(a).map(b=>b.toString(16).padStart(2,'0')).join(' ');
let n=0, ctrlSeen=0, lastF3d=-1;
const orig=mmu.doSiDma.bind(mmu);
mmu.doSiDma=function(toPif){
  if(toPif){ n++;
    // detect a channel-0 status/read request: first byte non-zero (not a skip)
    const b0=mmu.pifRam[0]&0xff;
    if(b0!==0x00){ ctrlSeen++; if(ctrlSeen<=10) console.error(`CTRL? #${n} instr=${cpu.instructionCount} step~ pif=${hex(mmu.pifRam.slice(0,24))}`); }
  }
  return orig(toPif);
};
let s=0;
for(;s<MAX;s++){ cpu.step();
  if(rcp.f3dTaskCount!==lastF3d && rcp.f3dTaskCount%20===0){ lastF3d=rcp.f3dTaskCount; console.error(`f3d=${rcp.f3dTaskCount} step=${s} siDMAs=${n} ch0Cmds=${mmu.controllerDebug.channel0Cmds}`);}
}
console.error('END step=',s,'siDMAs=',n,'ctrlSeen=',ctrlSeen,'f3d=',rcp.f3dTaskCount,'ch0Cmds=',mmu.controllerDebug.channel0Cmds,'infoReads=',mmu.controllerDebug.infoReads,'buttonReads=',mmu.controllerDebug.buttonReads);
