process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.INSTATE||'state_oot_scene',ram,mmu,cpu,rcp);
let ndcz=[],zbufOn=0,zbufOff=0,depthCmp=0;
const G_ZBUFFER=0x1;
const oP=rcp.projectClipToScreen.bind(rcp);
rcp.projectClipToScreen=function(tx,ty,tz,tw){
  const r=oP(tx,ty,tz,tw);
  if(Math.abs(tw)>1e-6){ndcz.push(tz/tw);}
  return r;
};
const oD=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(a,b,c){
  if(this.rspState.geometryMode & G_ZBUFFER)zbufOn++;else zbufOff++;
  return oD(a,b,c);
};
const t0=Date.now();const startF=rcp.f3dex2TaskCount|0;let bs=0;
for(let s=0;s<500000000;s++){cpu.step();
  if((s&0x3FFF)===0){const f=rcp.f3dex2TaskCount|0;const ph=(f-startF)%40;let w=(ph<6)?0x1000:0;if(w!==bs){mmu.updateController(w,0,0);bs=w;}
    if(f-startF>=250)break;if(Date.now()-t0>40000)break;}}
ndcz.sort((a,b)=>a-b);
const n=ndcz.length;
function pct(p){return ndcz[Math.min(n-1,Math.floor(p*n))];}
console.error('ndcZ count',n,'min',ndcz[0]?.toFixed(4),'p10',pct(.1)?.toFixed(4),'p50',pct(.5)?.toFixed(4),'p90',pct(.9)?.toFixed(4),'max',ndcz[n-1]?.toFixed(4));
console.error('zbufferOn tris',zbufOn,'zbufferOff tris',zbufOff);
console.error('depthImage',rcp.rspState.depthImage,'geometryMode',('00000000'+(rcp.rspState.geometryMode>>>0).toString(16)).slice(-8));
const vp=rcp.rspState.viewport;console.error('viewport',vp?JSON.stringify(vp):'n/a');
