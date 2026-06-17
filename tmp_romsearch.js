const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE, ram, mmu, cpu, rcp);
const A=parseInt(process.env.ADDR,16)&0x7FFFFF;
const rd=new Uint8Array(ram.rdram), rom=new Uint8Array(mmu.memory.rom);
const needle=rd.subarray(A,A+24);
console.error('needle: '+Buffer.from(needle).toString('hex'));
let found=-1;
outer: for(let i=0;i<rom.length-24;i++){
  if(rom[i]===needle[0]&&rom[i+1]===needle[1]){
    let ok=true; for(let j=2;j<24;j++)if(rom[i+j]!==needle[j]){ok=false;break;}
    if(ok){found=i;break outer;}
  }
}
console.error('rom offset: '+(found<0?'NOT FOUND':'0x'+found.toString(16)));
