// Boot probe: ROM= N= — step CPU, report task histogram/VI/PC/exceptions.
const {buildMachine}=require('./tmp_boot');
const N=parseInt(process.env.N||'30000000',10);
const m=buildMachine(process.env.ROM);
const {cpu,rcp,mmu}=m;
const t0=Date.now();
let s=0, threw=null;
const CH=1<<20;
for(;s<N;){
  try{ for(let i=0;i<CH && s<N;i++,s++) cpu.step(); }
  catch(e){ threw=e; break; }
  console.error(`@${s} pc=0x${(cpu.pc>>>0).toString(16)} tasks=${JSON.stringify(rcp.taskTypeHistogram)} f3d=${rcp.f3dTaskCount|0} f3dex2=${rcp.f3dex2TaskCount|0} vi1=0x${(mmu.viRegisters?(mmu.viRegisters[1]>>>0):0).toString(16)}`);
}
console.error(`done ${s} steps in ${(Date.now()-t0)/1000}s`);
if(threw)console.error('THREW @'+s+' pc=0x'+(cpu.pc>>>0).toString(16)+' : '+threw.stack.split('\n').slice(0,6).join('\n'));
