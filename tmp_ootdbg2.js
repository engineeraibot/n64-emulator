process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState('state_oot_title',ram,mmu,cpu,rcp);
const rd=new Uint8Array(mmu.memory.rdram);
rcp._dbgPix={};
let nf=0;const oP=rcp.processDisplayList.bind(rcp);
rcp.processDisplayList=function(addr,ds){rcp._dbgPix={};const r=oP(addr,ds);const d=rcp._dbgPix;
  if(d.firstP!==undefined&&nf<6){const p=d.firstP&0x7FFFFF;log('frame: firstWriteP=0x'+p.toString(16)+' colorImgAtWrite=0x'+(d.firstColorImg&0x7FFFFF).toString(16)+' valNow=0x'+(((rd[p]<<8)|rd[p+1])>>>0).toString(16)+' lastP=0x'+(d.lastP&0x7FFFFF).toString(16)+' colorImgFrameEnd=0x'+(this.rspState.colorImage>>>0&0x7FFFFF).toString(16));nf++;}return r;};
const startF=rcp.f3dex2TaskCount|0;const t0=Date.now();
for(let s=0;s<200000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){if((rcp.f3dex2TaskCount|0)-startF>=8)break;if(Date.now()-t0>30000)break;}}
