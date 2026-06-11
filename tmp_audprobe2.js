const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
let opcounts={}, tasks=0, aiBufs=[];
const orig=rcp.runRspTask.bind(rcp);
rcp.runRspTask=function(){
  const taskPtr=0xFC0;
  const type=mmu.spDmemView.getUint32(taskPtr+0x00,false);
  if(type===2){
    tasks++;
    const dataPtr=mmu.spDmemView.getUint32(taskPtr+0x30,false);
    const dataSize=mmu.spDmemView.getUint32(taskPtr+0x34,false)>>>0;
    const base=(dataPtr&0x7FFFFF);
    const dv=new DataView(mmu.memory.rdram);
    for(let i=0;i+8<=dataSize;i+=8){
      const op=dv.getUint8(base+i);
      opcounts[op]=(opcounts[op]||0)+1;
    }
  }
  return orig();
};
// hook AI DMA: capture the buffer the game hands to AI
const origAi=mmu.handleWrite?null:null;
// instead snoop aiRegisters on write via wrapping write
let aiSamplesNonZero=0, aiSamplesTotal=0, aiMax=0;
const origWrite=mmu.write32.bind(mmu);
let lastAiAddr=0;
mmu.write32=function(p,v){
  if(p>=0x04500000&&p<=0x04500017){
    const idx=(p-0x04500000)>>2;
    if(idx===0) lastAiAddr=v>>>0;
    if(idx===1){
      const len=(v&~7)>>>0;
      const base=(lastAiAddr&0x7FFFFF);
      const dv=new DataView(mmu.memory.rdram);
      for(let o=0;o+2<=len && o<len;o+=2){
        const s=dv.getInt16(base+o,false);
        aiSamplesTotal++; if(s!==0)aiSamplesNonZero++; if(Math.abs(s)>aiMax)aiMax=Math.abs(s);
      }
    }
  }
  return origWrite(p,v);
};
let i=0;
for(;i<60000000 && tasks<40;i++){cpu.step();}
console.log('steps',i,'audioTasks',tasks);
console.log('opcodes used:',Object.keys(opcounts).map(k=>'0x'+(+k).toString(16)+':'+opcounts[k]).join(' '));
console.log('AI samples total',aiSamplesTotal,'nonzero',aiSamplesNonZero,'max',aiMax);
