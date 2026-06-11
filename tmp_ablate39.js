const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_playable', ram, mmu, cpu, rcp);
if(process.env.NOTRI==='1') rcp.rasterizeTriangle=function(){};
if(process.env.NORSP==='1') rcp.runRspTask=function(){};
const N=parseInt(process.env.N||'12000000',10);
const t0=Date.now();let i=0;
for(;i<N;i++){try{cpu.step();}catch(e){break;}}
const dt=(Date.now()-t0)/1000;
console.log((process.env.NOTRI==='1'?'NOTRI':process.env.NORSP==='1'?'NORSP':'FULL'),'rate',(i/dt/1e6).toFixed(3)+'M/s f3d',rcp.f3dTaskCount|0);
