process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState('state_oot_c3',ram,mmu,cpu,rcp);
let dumped=0, targetFrame=-1, curTris=0, bestTris=0, bestFrame=-1;
// first pass: find frame index with most tris
const oP=rcp.processDisplayList.bind(rcp);
let frame=0;
rcp.processDisplayList=function(a,d){curTris=0;const r=oP(a,d);if(curTris>bestTris){bestTris=curTris;bestFrame=frame;}frame++;return r;};
const oD=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(a,b,c){curTris++;
  if(frame===targetFrame&&dumped<8){
    log('TRI ['+(a.x|0)+','+(a.y|0)+' z'+(a.z!==undefined?a.z.toFixed(2):'?')+'] ['+(b.x|0)+','+(b.y|0)+'] ['+(c.x|0)+','+(c.y|0)+'] rgb('+a.r+','+a.g+','+a.b+') a'+a.a+' useTex='+this.rspState.useTexture+' comb.lo=0x'+(this.rspState.combine.lo>>>0).toString(16)+' cimg=0x'+((this.rspState.colorImage>>>0)&0x7FFFFF).toString(16)+' zimg=0x'+((this.rspState.depthImage>>>0)&0x7FFFFF).toString(16)+' omLo=0x'+(this.rspState.otherModeLo>>>0).toString(16)+' cycle='+((this.rspState.otherModeHi>>>20)&3));
    dumped++;}
  return oD(a,b,c);};
const t0=Date.now();const startF=rcp.f3dex2TaskCount|0;let bs=0;
// pass to locate bestFrame, then we need targetFrame set; do two phases: run once to find best, but we can't rewind. So set target after detecting first geometry frame.
let firstGeoFrame=-1;
const oD2=rcp.drawTriangle;
for(let s=0;s<500000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if(firstGeoFrame<0&&curTris>50){firstGeoFrame=frame;targetFrame=frame;}
  if((s&0x3FFF)===0){const f=rcp.f3dex2TaskCount|0;const ph=(f-startF)%40;let w=(ph<6)?0x1000:0;if(w!==bs){mmu.updateController(w,0,0);bs=w;}
    if(dumped>=8)break;if(f-startF>=250)break;if(Date.now()-t0>40000)break;}}
log('bestTris',bestTris,'bestFrame',bestFrame,'firstGeoFrame',firstGeoFrame);
// viewport
log('viewport scale',JSON.stringify(rcp.rspState.viewport||rcp.rspState.vp||'n/a'));
