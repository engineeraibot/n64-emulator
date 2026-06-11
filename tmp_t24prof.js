const {buildMachine}=require('./tmp_boot');const {loadState}=require('./tmp_state');
const m=buildMachine();loadState('state_title_full',m.ram,m.mmu,m.cpu,m.rcp);
const c=m.cpu;
const hist=new Map();
const N=12000000;
for(let i=0;i<N;i++){const pc=c.pc>>>0;hist.set(pc,(hist.get(pc)||0)+1);c.step();}
const top=[...hist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,25);
for(const [pc,n] of top)console.log('0x'+pc.toString(16),n,(100*n/N).toFixed(1)+'%');
