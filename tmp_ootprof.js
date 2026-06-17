process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const st=process.env.INSTATE||'state_oot_probe1';
loadState(st,ram,mmu,cpu,rcp);
const N=parseInt(process.env.N||'8000000',10);
// opcode histogram
const opc=new Uint32Array(64), spc=new Uint32Array(64);
const origStep=cpu.step.bind(cpu);
const t0=Date.now();
let i=0;
for(;i<N;i++){
  const pc=cpu.pc>>>0;
  let w=0; try{w=cpu.readInstructionWord(pc)>>>0;}catch(e){}
  const op=(w>>>26)&0x3F; opc[op]++; if(op===0) spc[w&0x3F]++;
  try{cpu.step();}catch(e){console.log('threw',i,e.message);break;}
}
const dt=(Date.now()-t0)/1000;
console.log('state',st,'steps',i,'time',dt.toFixed(2)+'s','rate',(i/dt/1e6).toFixed(3)+'M/s','f3dex2',rcp.f3dex2TaskCount|0);
const top=[...opc].map((c,o)=>[o,c]).filter(x=>x[1]).sort((a,b)=>b[1]-a[1]).slice(0,12);
console.log('top primary opcodes (op:count):', top.map(x=>'0x'+x[0].toString(16)+':'+x[1]).join('  '));
const tops=[...spc].map((c,o)=>[o,c]).filter(x=>x[1]).sort((a,b)=>b[1]-a[1]).slice(0,10);
console.log('top SPECIAL funcs:', tops.map(x=>'0x'+x[0].toString(16)+':'+x[1]).join('  '));
