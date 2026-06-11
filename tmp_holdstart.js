const {buildMachine}=require('./tmp_boot');
const {loadState,saveState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
mmu.buttons=0x1000; // hold START
let firstCh0=-1, ch0polls=0;
const orig=mmu.processJoybusRead.bind(mmu);
mmu.processJoybusRead=function(){
  mmu.buttons=0x1000;
  const parsed=this.parseJoybusChannels();
  const chans=this.hasJoybusChannels(parsed)?parsed:this.joybusChannels;
  for(const ch of chans){if(ch&&ch.channel===0){const cmd=(ch.tx<64?this.pifRam[ch.tx]:0)&0xFF; if(cmd===0x01||cmd===0x00){ch0polls++; if(firstCh0<0){firstCh0=cpu.instructionCount; realLog('FIRST ch0 poll cmd0x'+cmd.toString(16)+' instr'+cpu.instructionCount);}}}}
  return orig();
};
const t0=Date.now();let s=0; const f3dStart=rcp.f3dTaskCount|0;
for(;;s++){try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
  if((s&0x1FFFF)===0){mmu.buttons=0x1000; if(Date.now()-t0>33000)break;}}
realLog('steps',s,'instr',cpu.instructionCount,'f3d',f3dStart,'->',rcp.f3dTaskCount|0,'ch0polls',ch0polls,'firstCh0',firstCh0);
saveState('state_hold1',ram,mmu,cpu,rcp);
realLog('saved state_hold1');
