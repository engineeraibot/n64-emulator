// ROM= OUT= SECS= — fresh boot, run for SECS wall, save state.
const {buildMachine}=require('./tmp_boot');
const {saveState}=require('./tmp_state');
const m=buildMachine(process.env.ROM);
const {ram,mmu,rcp,cpu}=m;
const SECS=parseFloat(process.env.SECS||'33');
const t0=Date.now();let s=0,threw=null;
for(;;s++){
  try{cpu.step();}catch(e){threw=e;break;}
  if((s&0x3FFFF)===0 && (Date.now()-t0)/1000>SECS)break;
}
saveState(process.env.OUT||'state_bootsave', ram, mmu, cpu, rcp);
console.error(`steps=${s} f3d=${rcp.f3dTaskCount|0} f3dex2=${rcp.f3dex2TaskCount|0} tasks=${JSON.stringify(rcp.taskTypeHistogram)} pc=0x${(cpu.pc>>>0).toString(16)}`+(threw?(' THREW '+threw.message):''));
