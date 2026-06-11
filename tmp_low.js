const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
let n=0, logs=[];
const orig=mmu.doSiDma.bind(mmu);
mmu.doSiDma=function(toPif){ if(toPif){ n++; if(n===1){ const rd=new Uint8Array(mmu.memory.rdram); console.error('AT SI#1 rdram[0x335b80]=0x'+((rd[0x335b80]<<24|rd[0x335b81]<<16|rd[0x335b82]<<8|rd[0x335b83])>>>0).toString(16)); for(const l of logs.slice(-12)) console.error(l); process.exit(0);} } return orig(toPif); };
const ow32=mmu.memory.write32.bind(mmu.memory);
mmu.memory.write32=function(a,v){ const p=a&0x7FFFFF; if(p===0x335b80) logs.push(`memW32 pc=0x${(cpu.pc>>>0).toString(16)} v=0x${(v>>>0).toString(16)}`); return ow32(a,v); };
// also catch set-based bypass: wrap copyPifToRdram
const ocp=mmu.copyPifToRdram.bind(mmu);
mmu.copyPifToRdram=function(d){ logs.push(`copyPifToRdram dram=0x${(d>>>0).toString(16)}`); return ocp(d); };
for(let s=0;s<40000000;s++) cpu.step();
