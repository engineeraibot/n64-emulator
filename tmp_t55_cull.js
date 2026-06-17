process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState('state_oot_c3',ram,mmu,cpu,rcp);
log('glr set?',!!rcp.glr);
let culled=0,vpEmpty=0,rast=0,reported=false;
const oC=rcp.clipTriangleToViewport.bind(rcp);
rcp.clipTriangleToViewport=function(a,b,c,w,h){const r=oC(a,b,c,w,h);if(r.length<3)vpEmpty++;return r;};
const oRT=rcp.rasterizeTriangle.bind(rcp);rcp.rasterizeTriangle=function(){rast++;return oRT.apply(this,arguments);};
// detect cull by checking gm bits
const oD=rcp.drawTriangle.bind(rcp);let curT=0;
rcp.drawTriangle=function(v1,v2,v3){curT++;
  if(!reported&&curT>200){const gm=this.rspState.geometryMode>>>0;log('geometryMode 0x'+gm.toString(16),'cullFront',!!(gm&0x200),'cullBack',!!(gm&0x400),'isF3DEX2',this.rspState.isF3DEX2,'omLo 0x'+(this.rspState.otherModeLo>>>0).toString(16));reported=true;}
  return oD(v1,v2,v3);};
const t0=Date.now();const startF=rcp.f3dex2TaskCount|0;let bs=0;
for(let s=0;s<500000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dex2TaskCount|0;const ph=(f-startF)%40;let w=(ph<6)?0x1000:0;if(w!==bs){mmu.updateController(w,0,0);bs=w;}
    if(f-startF>=120)break;if(Date.now()-t0>38000)break;}}
log('drawTri',curT,'viewportEmpty',vpEmpty,'rasterizeCalls',rast);
