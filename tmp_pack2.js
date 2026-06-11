const {buildMachine}=require('./tmp_boot.js');
const {ram,mmu,rcp,cpu}=buildMachine();
const hex=a=>Array.from(a).map(b=>b.toString(16).padStart(2,'0')).join(' ');
let n=0, logs=[];
const orig=mmu.doSiDma.bind(mmu);
mmu.doSiDma=function(toPif){ if(toPif){ n++; if(n===2){ console.error('AT SI#2 dram=0x'+(mmu.siRegisters[0]&0x7ffffc).toString(16)); for(const l of logs) console.error(l); console.error('pif',hex(mmu.pifRam.slice(0,16))); process.exit(0);} logs=[]; } return orig(toPif); };
const ow8=mmu.write8.bind(mmu), ow16=mmu.write16.bind(mmu), ow32=mmu.write32.bind(mmu);
function inRange(a){ const p=a&0x7FFFFF; return p>=0x336c80 && p<=0x336cd0; }
mmu.write32=function(a,v){ if(n<2&&inRange(a)) logs.push(`W32 pc=0x${(cpu.pc>>>0).toString(16)} a=0x${(a>>>0).toString(16)} v=0x${(v>>>0).toString(16)}`); return ow32(a,v); };
mmu.write16=function(a,v){ if(n<2&&inRange(a)) logs.push(`W16 pc=0x${(cpu.pc>>>0).toString(16)} a=0x${(a>>>0).toString(16)} v=0x${(v&0xffff).toString(16)}`); return ow16(a,v); };
mmu.write8=function(a,v){ if(n<2&&inRange(a)) logs.push(`W8  pc=0x${(cpu.pc>>>0).toString(16)} a=0x${(a>>>0).toString(16)} v=0x${(v&0xff).toString(16)}`); return ow8(a,v); };
for(let s=0;s<40000000;s++){ cpu.step(); }
console.error('end n=',n);
