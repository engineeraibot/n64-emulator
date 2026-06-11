const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState('state_t24b',ram,mmu,cpu,rcp);
mmu.aiSamplesEmitted=0;
let sinkCalls=0,sinkSamples=0,nonZero=0,maxAbs=0;
mmu.audioSink=(pcm,rate)=>{sinkCalls++;sinkSamples+=pcm.length;for(const s of pcm){if(s)nonZero++;const a=Math.abs(s);if(a>maxAbs)maxAbs=a;}};
let i=0;for(;i<9000000;i++){cpu.step();}
console.log('steps',i,'sinkCalls',sinkCalls,'sinkSamples',sinkSamples,'nonZeroPCM',nonZero,'maxAbs',maxAbs,'aiSamplesEmitted',mmu.aiSamplesEmitted);
