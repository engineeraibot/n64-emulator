const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
let n=0, logs=[];
const orig=mmu.doSiDma.bind(mmu);
mmu.doSiDma=function(toPif){ if(toPif){ n++; if(n===1){ const rd=new Uint8Array(mmu.memory.rdram); console.error('AT SI#1 bytes=', [0,1,2,3].map(i=>rd[0x335b80+i].toString(16))); for(const l of logs.slice(-16)) console.error(l); process.exit(0);} } return orig(toPif); };
const M=mmu.memory;
function inR(p){p&=0x7FFFFF; return p>=0x335b80&&p<=0x335b83;}
for(const fn of ['write8','write16','write32','write64']){ if(M[fn]){ const o=M[fn].bind(M); M[fn]=function(a,v){ if(inR(a)) logs.push(`${fn} pc=0x${(cpu.pc>>>0).toString(16)} a=0x${(a&0x7fffff).toString(16)} v=0x${(typeof v==='bigint'?v.toString(16):(v>>>0).toString(16))}`); return o(a,v);};}}
for(let s=0;s<40000000;s++) cpu.step();
