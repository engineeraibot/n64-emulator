process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState('state_oot_title',ram,mmu,cpu,rcp);
const rd=new Uint8Array(mmu.memory.rdram);
function scan(o){let nb=0;o&=0x7FFFFF;for(let i=0;i<320*240;i++){const p=o+i*2;const v=(rd[p]<<8)|rd[p+1];if(((v>>11)&31)>1||((v>>6)&31)>1||((v>>1)&31)>1)nb++;}return nb;}
let nframe=0;
const oP=rcp.processDisplayList.bind(rcp);
rcp.processDisplayList=function(addr,ds){
  const r=oP(addr,ds);
  const ci=this.rspState.colorImage>>>0;
  if(ci && nframe<8){log('frame done, colorImg=0x'+ci.toString(16)+' nb(immediately)='+scan(ci));nframe++;}
  return r;
};
const startF=rcp.f3dex2TaskCount|0;const t0=Date.now();
for(let s=0;s<200000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){if((rcp.f3dex2TaskCount|0)-startF>=10)break;if(Date.now()-t0>30000)break;}}
