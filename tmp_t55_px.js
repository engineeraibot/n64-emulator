process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState('state_oot_c3',ram,mmu,cpu,rcp);
let px=0,rasterCalls=0,curTris=0,reported=false;
const oR=rcp.rasterizeTriangle.bind(rcp);
rcp.rasterizeTriangle=function(a,b,c,addr){rasterCalls++;
  if(!reported&&curTris>50){log('colorImageWidth',this.rspState.colorImageWidth,'colorImageSize',this.rspState.colorImageSize,'depthImage 0x'+(this.rspState.depthImage>>>0).toString(16),'geometryMode 0x'+(this.rspState.geometryMode>>>0).toString(16),'zEnabled',((this.rspState.geometryMode&1)!==0),'omLo 0x'+(this.rspState.otherModeLo>>>0).toString(16),'omHi 0x'+(this.rspState.otherModeHi>>>0).toString(16));reported=true;}
  const rd=new Uint8Array(this.mmu.memory.rdram);const ci=(this.rspState.colorImage>>>0)&0x7FFFFF;let b0=0;for(let i=0;i<320*240*2;i++)b0+=rd[ci+i];
  const r=oR(a,b,c,addr);let b1=0;for(let i=0;i<320*240*2;i++)b1+=rd[ci+i];if(b1!==b0)px++;
  return r;};
const oP=rcp.processDisplayList.bind(rcp);rcp.processDisplayList=function(a,d){curTris=0;return oP(a,d);};
const oD=rcp.drawTriangle.bind(rcp);rcp.drawTriangle=function(a,b,c){curTris++;return oD(a,b,c);};
const t0=Date.now();const startF=rcp.f3dex2TaskCount|0;let bs=0;
for(let s=0;s<500000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dex2TaskCount|0;const ph=(f-startF)%40;let w=(ph<6)?0x1000:0;if(w!==bs){mmu.updateController(w,0,0);bs=w;}
    if(f-startF>=120)break;if(Date.now()-t0>38000)break;}}
log('rasterCalls',rasterCalls,'frames-with-pixelchange',px);
