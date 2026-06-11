const {buildMachine}=require('./tmp_boot.js');
const {ram,mmu,rcp,cpu}=buildMachine();
const hex=a=>Array.from(a).map(b=>b.toString(16).padStart(2,'0')).join(' ');
let n=0;
const orig=mmu.doSiDma.bind(mmu);
mmu.doSiDma=function(toPif){
  if(toPif){ n++; const ra=mmu.siRegisters[0]&0x007FFFFC;
    if(n<=5) console.error(`#${n} dramAddr=0x${ra.toString(16)} instr=${cpu.instructionCount} pif=${hex(mmu.pifRam.slice(0,16))}`);
  }
  return orig(toPif);
};
for(let s=0;s<40000000;s++){ cpu.step(); if(n>=5)break; }
console.error('stop n=',n);
