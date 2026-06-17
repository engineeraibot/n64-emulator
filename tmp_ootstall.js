process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState(process.env.INSTATE||'state_oot_n64logo',ram,mmu,cpu,rcp);
const PRESSAT=process.env.PRESSAT?parseInt(process.env.PRESSAT):-1;
const startF=rcp.f3dex2TaskCount|0;
let bs=0;
const pcHist=new Map();
let lastReport=Date.now();
const t0=Date.now();
let win=new Map(), winStart=0;
for(let s=0;s<500000000;s++){
  const pc=cpu.pc>>>0;
  if((s&0x3)===0){ // sample PC
    const b=pc&~0xFFF; win.set(b,(win.get(b)||0)+1);
  }
  try{cpu.step();}catch(e){log('THREW',s,e.message);break;}
  if((s&0x3FFF)===0){
    const f=rcp.f3dex2TaskCount|0;
    if(PRESSAT>=0){const ph=(f-startF)%60;let w=(ph>=PRESSAT&&ph<PRESSAT+8)?0x1000:0;if(w!==bs){mmu.updateController(w,0,0);bs=w;}}
    if(Date.now()-t0>30000){log('[budget] step',s,'f3dex2',f);break;}
  }
}
const top=[...win.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12);
log('top PC pages (4KB) by sample count:');
for(const [b,c] of top) log('  0x'+(b>>>0).toString(16),c);
log('PI DMA count', mmu.piDmaCount|0, 'SI', mmu.siDmaCount|0, 'viInt', mmu.viInterruptCount|0, 'f3dex2', rcp.f3dex2TaskCount|0);
