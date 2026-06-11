const {buildMachine}=require('./tmp_boot.js');
const {ram,mmu,rcp,cpu}=buildMachine();
const hex=a=>Array.from(a).map(b=>b.toString(16).padStart(2,'0')).join(' ');
const seen=new Map();
let n=0;
const orig=mmu.doSiDma.bind(mmu);
mmu.doSiDma=function(toPif){
  if(toPif){ n++; const ra=mmu.siRegisters[0]&0x7ffffc; const rd=new Uint8Array(mmu.memory.rdram);
    const key=hex(rd.slice(ra,ra+16)); seen.set(key,(seen.get(key)||0)+1);
  }
  return orig(toPif);
};
for(let s=0;s<40000000;s++){ cpu.step(); }
console.error('total SI writes=',n,'f3d=',rcp.f3dTaskCount);
for(const [k,c] of seen) console.error(`x${c}  ${k}`);
