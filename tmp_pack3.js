const {buildMachine}=require('./tmp_boot.js');
const {ram,mmu,rcp,cpu}=buildMachine();
const hex=a=>Array.from(a).map(b=>b.toString(16).padStart(2,'0')).join(' ');
let n=0;
const orig=mmu.doSiDma.bind(mmu);
mmu.doSiDma=function(toPif){
  if(toPif){ n++;
    if(n>=2&&n<=4){ const ra=mmu.siRegisters[0]&0x7ffffc; const rd=new Uint8Array(mmu.memory.rdram);
      console.error(`SI#${n} dram=0x${ra.toString(16)} rdram@dram=${hex(rd.slice(ra,ra+16))}`);
    }
    if(n===4) process.exit(0);
  }
  const r=orig(toPif);
  if(toPif&&n>=2&&n<=4) console.error(`   -> pif=${hex(mmu.pifRam.slice(0,16))}`);
  return r;
};
for(let s=0;s<40000000;s++){ cpu.step(); }
