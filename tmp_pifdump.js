const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
const realLog=console.log.bind(console);
const orig=mmu.doSiDma.bind(mmu);
let n=0,stop=false;
function hex(){let s='';for(let i=0;i<64;i++){s+=(mmu.pifRam[i]&0xFF).toString(16).padStart(2,'0')+((i&15)==15?'\n':' ');}return s;}
mmu.doSiDma=function(toPif){
  if(n<8){realLog('=== '+(toPif?'WRITE':'READ ')+' #'+n+' instr'+cpu.instructionCount+' pc0x'+(cpu.pc>>>0).toString(16)+' ===');realLog(hex());}
  const r=orig(toPif);
  if(n<8 && !toPif){realLog('--- after read parse ---');realLog(hex());}
  n++; if(n>=8)stop=true;
  return r;
};
let s=0;for(;s<600000000 && !stop;s++){try{cpu.step();}catch(e){realLog('THREW',e.message);break;}}
realLog('done instr',cpu.instructionCount);
