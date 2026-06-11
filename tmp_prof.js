const {buildMachine}=require('./tmp_boot.js');
const {loadState}=require('./tmp_state.js');
const M=buildMachine();
loadState(process.env.STATE||'state_title_full',M.ram,M.mmu,M.cpu,M.rcp);
const c=M.cpu;
const N=parseInt(process.env.N||'30000000');
const t0=Date.now();
for(let i=0;i<N;i++)c.step();
console.error('steps/s='+((N/((Date.now()-t0)/1000))/1e6).toFixed(3)+'M');
