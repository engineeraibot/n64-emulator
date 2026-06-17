// ROM= WARM= SAMPLE= — run WARM steps, then histogram PCs over SAMPLE steps.
const {buildMachine}=require('./tmp_boot');
const m=buildMachine(process.env.ROM);
const {cpu,rcp}=m;
const WARM=parseInt(process.env.WARM||'25000000',10);
const SAMPLE=parseInt(process.env.SAMPLE||'2000000',10);
for(let i=0;i<WARM;i++)cpu.step();
console.error('warm done f3d='+(rcp.f3dTaskCount|0)+' tasks='+JSON.stringify(rcp.taskTypeHistogram));
const h=new Map();
for(let i=0;i<SAMPLE;i++){cpu.step();const pc=cpu.pc>>>0;h.set(pc,(h.get(pc)||0)+1);}
const top=[...h.entries()].sort((a,b)=>b[1]-a[1]).slice(0,25);
for(const [pc,n] of top)console.error('0x'+pc.toString(16)+' '+n);
