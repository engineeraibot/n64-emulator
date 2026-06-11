const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
for(let s=0;s<2000000;s++) cpu.step();
const b=new Uint8Array(ram.rdram);
function rd(a){a&=0x7FFFFF;return (b[a]<<24|b[a+1]<<16|b[a+2]<<8|b[a+3])>>>0;}
// scan kseg0 code region 0x80000000..0x80400000 for addiu/lw/sw with imm 0x6ca0
let hits=[];
for(let p=0x10000;p<0x400000;p+=4){
  const w=rd(0x80000000|p); const op=w>>>26, imm=w&0xffff;
  if(imm===0x6ca0 && (op===0x09||op===0x23||op===0x2b)) hits.push(0x80000000|p);
}
console.log('refs to ...,0x6ca0:',hits.map(h=>'0x'+(h>>>0).toString(16)).join(' '));
