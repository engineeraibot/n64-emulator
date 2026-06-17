const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
process.env.ROM=process.env.ROMNAME;
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.INSTATE,ram,mmu,cpu,rcp);
const rd=new Uint8Array(mmu.memory.rdram);
let hits=0;
const oC=rcp._compositeOverlayFillRect.bind(rcp);
rcp._compositeOverlayFillRect=function(hi,lo){hits++;return oC(hi,lo);};
let best=0;
function nbScan(ci){let nb=0;for(let i=0;i<320*240;i++){const v=(rd[ci+i*2]<<8)|rd[ci+i*2+1];if(((v>>11)&31)>1||((v>>6)&31)>1||((v>>1)&31)>1)nb++;}return nb;}
const oP=rcp.processDisplayList.bind(rcp);
rcp.processDisplayList=function(a,d){const r=oP(a,d);const ci=(this.rspState.colorImage>>>0)&0x7FFFFF;const nb=nbScan(ci);if(nb>best)best=nb;return r;};
const t0=Date.now();const startF=(rcp.f3dex2TaskCount|0)+(rcp.f3dTaskCount|0);let bs=0;
const ADV=parseInt(process.env.ADV||'10');
for(let s=0;s<200000000;s++){cpu.step();
  if((s&0x3FFF)===0){const f=(rcp.f3dex2TaskCount|0)+(rcp.f3dTaskCount|0);if(f-startF>=ADV)break;if(Date.now()-t0>30000)break;}}
console.error(process.env.INSTATE,'compositeHits',hits,'bestNb',best);
