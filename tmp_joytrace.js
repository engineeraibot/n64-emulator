const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
console.log=()=>{};console.warn=()=>{};console.error=()=>{};
// wrap processJoybusRead
const orig=mmu.processJoybusRead.bind(mmu);
let cmdHist={};
mmu.processJoybusRead=function(){
  const parsed=this.parseJoybusChannels();
  const channels=this.hasJoybusChannels(parsed)?parsed:this.joybusChannels;
  for(const ch of channels){ if(!ch) continue; const cmd=(ch.tx<64?this.pifRam[ch.tx]:0)&0xFF;
    const key='ch'+ch.channel+':cmd'+cmd.toString(16); cmdHist[key]=(cmdHist[key]||0)+1;}
  return orig();
};
const t0=Date.now();
let s=0;
for(;;s++){ try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
  if((s&0x3FFFF)===0 && Date.now()-t0>38000){break;} }
realLog('steps',s,'f3d',rcp.f3dTaskCount|0,'ch0Cmds',mmu.controllerDebug.channel0Cmds);
realLog('cmdHist',JSON.stringify(cmdHist));
