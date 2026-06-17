process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
let segWrites=0,dlResolves=0,cimg=0;
const origMW=rcp.handleG_MOVEWORD.bind(rcp);
rcp.handleG_MOVEWORD=function(hi,lo){
  const index=(hi>>>16)&0xFF;
  if(index===0x06 && segWrites<30){log('SEG['+(((hi&0xFFFF)>>>2)&0xF)+'] = 0x'+(lo>>>0).toString(16));segWrites++;}
  return origMW(hi,lo);
};
const origRes=rcp.resolveAddress.bind(rcp);
// Hook processDisplayList to watch G_DL jumps: wrap resolveAddress is too broad; instead track via counting
const t0=Date.now();
let firstTaskDumped=false;
const origProc=rcp.processDisplayList.bind(rcp);
rcp.processDisplayList=function(addr,dataSize){
  if(!firstTaskDumped && (rcp.f3dex2TaskCount|0)>=2){
    firstTaskDumped=true;
    log('--- first task DL dump, startAddr=0x'+(addr>>>0).toString(16)+' size='+dataSize);
    let pc=addr>>>0;
    for(let i=0;i<40;i++){const h=this.mmu.read32(pc)>>>0,l=this.mmu.read32(pc+4)>>>0;const op=(h>>>24)&0xFF;
      log('  pc=0x'+pc.toString(16)+' op=0x'+op.toString(16)+' hi=0x'+h.toString(16)+' lo=0x'+l.toString(16)+(op===0xDE?(' -> resolve 0x'+(this.resolveAddress(l)>>>0).toString(16)):'')+(op===0xFF?' [SETCIMG]':''));
      pc+=8;if(op===0xDF)break;}
  }
  return origProc(addr,dataSize);
};
for(let s=0;s<300000000;s++){try{cpu.step();}catch(e){log('THREW',s,e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dex2TaskCount|0;if(f>=60){log('reached f3dex2',f,'step',s);break;}if(Date.now()-t0>32000){log('[budget]',s,'f3dex2',f);break;}}}
log('segWrites total context:',segWrites,'segments:',(rcp.rspState.segments||[]).map((x,i)=>'['+i+']=0x'+(x>>>0).toString(16)).join(' '));
log('colorImage=0x'+(rcp.rspState.colorImage>>>0).toString(16));
