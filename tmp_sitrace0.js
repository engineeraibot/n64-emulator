const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
const realLog=console.log.bind(console);
const orig=mmu.doSiDma.bind(mmu);
let n=0,stop=false;
mmu.doSiDma=function(toPif){
  const parsed=this.parseJoybusChannels();
  const chans=this.hasJoybusChannels(parsed)?parsed:this.joybusChannels;
  let desc=[];
  for(const ch of chans){if(!ch)continue;const cmd=(ch.tx<64?this.pifRam[ch.tx]:0)&0xFF;desc.push('ch'+ch.channel+'/cmd0x'+cmd.toString(16)+'/sl'+ch.sl+'/rl'+ch.rl);}
  if(n<40){realLog((toPif?'SIwrite#':'SIread#')+n,'instr'+cpu.instructionCount,'pifCmd0x'+(this.pifRam[0x3F]&0xFF).toString(16),desc.join(' ')||'(no chans)');}
  n++; if(n>=40)stop=true;
  return orig(toPif);
};
let s=0;for(;s<200000000 && !stop;s++){try{cpu.step();}catch(e){realLog('THREW',e.message);break;}}
realLog('done instr',cpu.instructionCount,'SItotal',n);
