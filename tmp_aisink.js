const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
let sinkCalls=0,sinkSamples=0;
mmu.audioSink=(pcm,rate)=>{sinkCalls++;sinkSamples+=pcm.length;};
// 1) direct unit: put PCM at 0x8000, write AI regs
const rd=new DataView(mmu.memory.rdram);
for(let i=0;i<64;i++)rd.setInt16(0x8000+i*2,(i-32)*100,false);
mmu.write32(0x04500000,0x8000);   // AI_DRAM_ADDR
mmu.write32(0x04500008,0x2);      // AI_DACRATE
mmu.write32(0x04500004,128);      // AI_LEN (128 bytes -> 64 samples)
console.log('direct: sinkCalls',sinkCalls,'sinkSamples',sinkSamples,'lastAi',mmu.lastAiSamples?mmu.lastAiSamples.length:0);
// 2) real boot: confirm the game's AI DMAs reach the sink
sinkCalls=0;sinkSamples=0;
let i=0;for(;i<8000000;i++){cpu.step();}
console.log('boot: aiSamplesEmitted',mmu.aiSamplesEmitted,'sinkCalls',sinkCalls,'sinkSamples',sinkSamples);
