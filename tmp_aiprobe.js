// Probe: audio production rate in emulated time from a state.
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const IN=process.env.STATE||'state_playable';
loadState(IN, ram, mmu, cpu, rcp);
const log=console.log.bind(console);
let emits=0, frames=0, lens={};
const origEmit=mmu.emitAudioBuffer.bind(mmu);
mmu.emitAudioBuffer=(addr,len)=>{emits++;frames+=len>>2;lens[len]=(lens[len]||0)+1;return origEmit(addr,len);};
const N=parseInt(process.env.N||'30000000',10);
const step0=cpu.instructionCount;
for(let s=0;s<N;s++) cpu.step();
const steps=cpu.instructionCount-step0;
const dac=mmu.aiRegisters[2]>>>0;
const rate=dac>0?Math.round(48681812/(dac+1)):0;
log('steps',steps,'emits',emits,'frames',frames,'dacRate',dac,'->',rate,'Hz');
log('frames per 9.6M steps (expect ~'+rate+'):',(frames/steps*9.6e6).toFixed(0));
log('len histogram:',JSON.stringify(lens));
