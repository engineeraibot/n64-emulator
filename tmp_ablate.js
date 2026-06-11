const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
function run(mut,label){
  const {ram,mmu,rcp,cpu}=buildMachine();
  loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
  mut(cpu,mmu,rcp);
  const N=parseInt(process.env.N||'12000000',10);const t=Date.now();
  for(let i=0;i<N;i++){try{cpu.step();}catch(e){console.log('threw',e.message);break;}}
  const dt=(Date.now()-t)/1000;console.log(label.padEnd(28),(N/dt/1e6).toFixed(3)+'M/s');
}
run(()=>{}, 'baseline');
run((c)=>{c.serviceCompareTimer=function(){};}, 'no serviceCompareTimer');
run((c,m)=>{m.checkInternalEvents=function(){};}, 'no checkInternalEvents');
run((c)=>{const r=c.readInstructionWord.bind(c);}, 'noop(control)');
run((c,m)=>{c.serviceCompareTimer=function(){};m.checkInternalEvents=function(){};}, 'no timer+events');
