const rom=process.env.ROM; const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.INSTATE,ram,mmu,cpu,rcp);
let inv=0; const orig=cpu.invalidateCache.bind(cpu);
cpu.invalidateCache=function(){inv++;return orig();};
const N=parseInt(process.env.N||'8000000',10);
for(let i=0;i<N;i++){try{cpu.step();}catch(e){break;}}
console.log(process.env.INSTATE,'steps',N,'invalidateCache calls',inv,'=> 1 per',(N/Math.max(1,inv)).toFixed(0),'steps','PIdma',mmu.piDmaCount|0);
