process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState(process.env.INSTATE||'state_oot_c2',ram,mmu,cpu,rcp);
const pcExact=new Map();
const t0=Date.now();let steps=0;
const piBefore=mmu._totalPiDmaCount|0, spBefore=(mmu._spDmaCount|0);
const viBefore=mmu.viInterruptCount|0;
for(let s=0;s<400000000;s++){
  const pc=cpu.pc>>>0; pcExact.set(pc,(pcExact.get(pc)||0)+1);
  try{cpu.step();}catch(e){log('THREW',s,e.message);break;}steps=s;
  if((s&0x3FFF)===0){if(Date.now()-t0>30000)break;}
}
const dt=(Date.now()-t0)/1000;
log('steps',steps,'rate',(steps/dt/1e6).toFixed(2)+'M/s');
log('PI DMA this run +'+((mmu._totalPiDmaCount|0)-piBefore),'total',mmu._totalPiDmaCount|0,'viInt +'+((mmu.viInterruptCount|0)-viBefore));
const top=[...pcExact.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15);
log('top exact PCs (count, %):');
for(const [pc,c] of top) log('  0x'+(pc>>>0).toString(16),c,(100*c/steps).toFixed(1)+'%');
