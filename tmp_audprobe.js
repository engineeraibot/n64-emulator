const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
// hook runRspTask to capture type-2 audio command list
let captured=null, count=0;
const orig=rcp.runRspTask.bind(rcp);
rcp.runRspTask=function(){
  const taskPtr=0xFC0;
  const type=mmu.spDmemView.getUint32(taskPtr+0x00,false);
  if(type===2){
    count++;
    if(count===3){ // grab a steady-state one
      const dataPtr=mmu.spDmemView.getUint32(taskPtr+0x30,false);
      const dataSize=mmu.spDmemView.getUint32(taskPtr+0x34,false)>>>0;
      captured={dataPtr,dataSize};
      // dump first commands
      const base=(dataPtr&0x7FFFFF);
      const dv=new DataView(mmu.memory.rdram);
      let out=[];
      for(let i=0;i<Math.min(dataSize, 256);i+=8){
        const w0=dv.getUint32(base+i,false)>>>0, w1=dv.getUint32(base+i+4,false)>>>0;
        out.push((w0>>>24).toString(16).padStart(2,'0')+' '+w0.toString(16).padStart(8,'0')+' '+w1.toString(16).padStart(8,'0'));
      }
      console.log('AUDIO task dataPtr=0x'+dataPtr.toString(16),'size='+dataSize);
      console.log(out.join('\n'));
    }
  }
  return orig();
};
let i=0;
for(;i<60000000 && count<3;i++){cpu.step();}
console.log('steps',i,'audioTasks',count);
