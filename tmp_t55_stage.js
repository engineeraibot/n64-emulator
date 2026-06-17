process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState('state_oot_c3',ram,mmu,cpu,rcp);
let calls=0,aabb=0,nearclip=0,reachVP=0;
const oA=rcp.clipTriangleNearPlane.bind(rcp);
rcp.clipTriangleNearPlane=function(a,b,c){const r=oA(a,b,c);return r;};
const oD=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(v1,v2,v3){
  calls++;
  const sw=(this.rspState.colorImageWidth|0)||320,sh=240;
  const off=((v1.x<0&&v2.x<0&&v3.x<0)||(v1.x>=sw&&v2.x>=sw&&v3.x>=sw)||(v1.y<0&&v2.y<0&&v3.y<0)||(v1.y>=sh&&v2.y>=sh&&v3.y>=sh));
  if(off)aabb++;
  else{const cl=this.clipTriangleNearPlane(v1,v2,v3);if(cl.length<3)nearclip++;else reachVP++;}
  return oD(v1,v2,v3);
};
const oP=rcp.processDisplayList.bind(rcp);let curT=0;rcp.processDisplayList=function(a,d){return oP(a,d);};
const t0=Date.now();const startF=rcp.f3dex2TaskCount|0;let bs=0;
for(let s=0;s<500000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dex2TaskCount|0;const ph=(f-startF)%40;let w=(ph<6)?0x1000:0;if(w!==bs){mmu.updateController(w,0,0);bs=w;}
    if(f-startF>=120)break;if(Date.now()-t0>38000)break;}}
log('drawTri calls',calls,'AABB-rejected',aabb,'nearClip-rejected',nearclip,'reachViewport',reachVP,'colorImageWidth',rcp.rspState.colorImageWidth);
