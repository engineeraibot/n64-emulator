const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState('state_hold1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
const rd=new Uint8Array(ram.rdram);
let curThread=0; const recv={}; let dispatch={};
const t0=Date.now();let s=0;
for(;;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x802f40b0){curThread=cpu.gpr[26]>>>0; dispatch[curThread]=(dispatch[curThread]||0)+1;}
  if(pc===0x802ef780){const q=cpu.gpr[4]>>>0; const key=(curThread>>>0).toString(16)+':q'+q.toString(16); recv[key]=(recv[key]||0)+1;}
  try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((s&0x1FFFF)===0 && Date.now()-t0>30000)break;
}
realLog('steps',s,'instr',cpu.instructionCount,'f3d',rcp.f3dTaskCount|0);
realLog('dispatch:',Object.entries(dispatch).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>'0x'+(+k).toString(16)+':'+v).join(' '));
realLog('osRecvMesg by thread:queue:',Object.entries(recv).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>k+'x'+v).join('  '));
