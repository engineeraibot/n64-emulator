const {buildMachine}=require('./tmp_boot');const {loadState}=require('./tmp_state');
function run(press){
  const m=buildMachine();loadState('state_title_full',m.ram,m.mmu,m.cpu,m.rcp);
  const c=m.cpu;
  if(press)m.mmu.updateController(0x1000,0,0); else m.mmu.updateController(0,0,0);
  const N=4000000;
  for(let i=0;i<N;i++){c.step(); if(press&&(i%200000===0))m.mmu.updateController(0x1000,0,0);}
  return new Uint8Array(m.ram.rdram.slice(0));
}
const A=run(true),B=run(false);
const rdA=new DataView(A.buffer),rdB=new DataView(B.buffer);
let hits=[];
for(let off=0x80;off+2<=A.length;off+=2){
  const a=rdA.getUint16(off),b=rdB.getUint16(off);
  if(a===0x1000 && b!==0x1000) hits.push(off);
}
console.log('hits(0x1000 in press,not nopress):',hits.length);
console.log(hits.slice(0,40).map(h=>'0x'+(0x80000000+h>>>0).toString(16)).join(' '));
