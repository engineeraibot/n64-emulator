const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
const hex=a=>Array.from(a).map(b=>b.toString(16).padStart(2,'0')).join(' ');
let n=0;
const orig=mmu.doSiDma.bind(mmu);
mmu.doSiDma=function(toPif){
  if(toPif){ n++; const ra=mmu.siRegisters[0]&0x7ffffc; const rd=new Uint8Array(mmu.memory.rdram);
    if(n<=6) console.error(`SI#${n} dram=0x${ra.toString(16)} src=${hex(rd.slice(ra,ra+16))}`);
    if(n===6) process.exit(0);
  } return orig(toPif);
};
for(let s=0;s<40000000;s++) cpu.step();
