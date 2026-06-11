const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
let i=0; for(;i<10000000 && (rcp.audioTasksRun|0)<40;i++){cpu.step();}
console.log('steps',i,'audioTasksRun',rcp.audioTasksRun,
  'outSamples',rcp.audioOutSampleCount,'outNonZero',rcp.audioOutNonZero,
  'lastPcm',JSON.stringify(rcp.lastAudioPcm));
// dump amplitude stats of last saved buffer
if(rcp.lastAudioPcm){
  const dv=new DataView(mmu.memory.rdram);const {addr,len}=rcp.lastAudioPcm;
  let mx=0,nz=0,n=0;
  for(let o=0;o+1<len;o+=2){const s=dv.getInt16(addr+o,false);if(s)nz++;if(Math.abs(s)>mx)mx=Math.abs(s);n++;}
  console.log('lastBuf samples',n,'nonzero',nz,'maxAbs',mx);
}
