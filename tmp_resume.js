const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const realLog=console.log.bind(console);
const m=loadState(process.env.STATE||'state_f3d96', ram, mmu, cpu, rcp);
realLog('loaded f3d',m.rcp.f3dTaskCount,'pc=0x'+(cpu.pc>>>0).toString(16),'instrCount',cpu.instructionCount);
// reset f3d counter so we can detect NEW gfx task submissions
rcp.f3dTaskCount=0; rcp.rspTaskCount=0;
const PRESS=process.env.PRESS==='1';
const N=parseInt(process.argv[2]||'12000000',10);
const hist=new Map(); let maxF3d=0; let firstNewTaskStep=-1;
const t0=Date.now();
for(let s=0;s<N;s++){
  if(PRESS && s===2000000){mmu.updateController(0x1000,0,0);realLog('pressed START at rel-step',s);}
  try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
  const pc=cpu.pc>>>0; hist.set(pc,(hist.get(pc)||0)+1);
  const f=rcp.f3dTaskCount|0; if(f>maxF3d){maxF3d=f; if(firstNewTaskStep<0)firstNewTaskStep=s;}
  if((s&0x3FFFF)===0 && Date.now()-t0>40000){realLog('budget rel-step',s);break;}
}
realLog('after resume: NEW f3dTasks',maxF3d,'firstNewTaskRelStep',firstNewTaskStep,'rspTasks',rcp.rspTaskCount|0,'ch0',mmu.controllerDebug.channel0Cmds,'btnReads',mmu.controllerDebug.buttonReads);
const top=[...hist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,16);
realLog('--- top PCs ---'); for(const[pc,n]of top)realLog('0x'+pc.toString(16),n);
