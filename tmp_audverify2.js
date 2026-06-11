const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_t24b',ram,mmu,cpu,rcp);
rcp.audioOutNonZero=0;rcp.audioOutSampleCount=0;rcp.audioTasksRun=0;
let i=0,bestMax=0;
const N=parseInt(process.env.N||'30000000',10);
for(;i<N;i++){cpu.step();
  if((i&0x3FFFFF)===0 && rcp.lastAudioPcm){
    const dv=new DataView(mmu.memory.rdram);const {addr,len}=rcp.lastAudioPcm;
    for(let o=0;o+1<len;o+=2){const s=Math.abs(dv.getInt16(addr+o,false));if(s>bestMax)bestMax=s;}
  }
}
console.log('STATE',process.env.STATE||'state_t24b','steps',i,'audioTasks',rcp.audioTasksRun,
  'outSamples',rcp.audioOutSampleCount,'outNonZero',rcp.audioOutNonZero,'bestMaxAbs',bestMax);
