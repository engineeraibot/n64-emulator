const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
const hex=a=>Array.from(a).map(b=>b.toString(16).padStart(2,'0')).join(' ');
let n=0, logs=[];
const orig=mmu.doSiDma.bind(mmu);
mmu.doSiDma=function(toPif){ if(toPif){ n++; if(n===1){ console.error('AT SI#1 dram=0x'+(mmu.siRegisters[0]&0x7ffffc).toString(16)); for(const l of logs) console.error(l); const rd=new Uint8Array(mmu.memory.rdram); console.error('src',hex(rd.slice(0x335b80,0x335b80+16))); process.exit(0);} } return orig(toPif); };
const ow8=mmu.write8.bind(mmu), ow16=mmu.write16.bind(mmu), ow32=mmu.write32.bind(mmu);
function inR(a){const p=a&0x7FFFFF; return p>=0x335b70 && p<=0x335bb0;}
mmu.write32=function(a,v){ if(inR(a)) logs.push(`W32 pc=0x${(cpu.pc>>>0).toString(16)} a=0x${(a>>>0).toString(16)} v=0x${(v>>>0).toString(16)}`); return ow32(a,v); };
mmu.write16=function(a,v){ if(inR(a)) logs.push(`W16 pc=0x${(cpu.pc>>>0).toString(16)} a=0x${(a>>>0).toString(16)} v=0x${(v&0xffff).toString(16)}`); return ow16(a,v); };
mmu.write8=function(a,v){ if(inR(a)) logs.push(`W8  pc=0x${(cpu.pc>>>0).toString(16)} a=0x${(a>>>0).toString(16)} v=0x${(v&0xff).toString(16)}`); return ow8(a,v); };
for(let s=0;s<40000000;s++) cpu.step();
