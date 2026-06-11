const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
const N=parseInt(process.env.N||'20000000',10);
const t0=Date.now();
let i=0;
for(;i<N;i++){try{cpu.step();}catch(e){console.log('threw',i,e.message);break;}}
const dt=(Date.now()-t0)/1000;
console.log('steps',i,'time',dt.toFixed(2)+'s','rate',(i/dt/1e6).toFixed(3)+'M/s','f3d',rcp.f3dTaskCount|0);
