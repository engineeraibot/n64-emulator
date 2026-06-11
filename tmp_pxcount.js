const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_playable', ram, mmu, cpu, rcp);
let pixels=0, tris=0, pxIter=0;
const orig=rcp.rasterizeTriangle.bind(rcp);
rcp.rasterizeTriangle=function(v1,v2,v3,addr){
  tris++;
  const minX=Math.floor(Math.min(v1.x,v2.x,v3.x)),maxX=Math.ceil(Math.max(v1.x,v2.x,v3.x));
  const minY=Math.floor(Math.min(v1.y,v2.y,v3.y)),maxY=Math.ceil(Math.max(v1.y,v2.y,v3.y));
  pxIter+=Math.max(0,(maxX-minX+1))*Math.max(0,(maxY-minY+1));
  return orig(v1,v2,v3,addr);
};
const N=parseInt(process.env.N||'12000000',10);
const t0=Date.now();let i=0;
const rw0=rcp.drawStats.rowWrites.reduce((a,b)=>a+b,0);
const sc0=rcp.textureSampleStats.calls;
for(;i<N;i++){try{cpu.step();}catch(e){break;}}
const dt=(Date.now()-t0)/1000;
const rw=rcp.drawStats.rowWrites.reduce((a,b)=>a+b,0)-rw0;
const sc=rcp.textureSampleStats.calls-sc0;
console.log('time',dt.toFixed(1),'f3d',rcp.f3dTaskCount|0,'tris',tris,'pxWritten',rw,'texSamples',sc,'bboxPxIterated',pxIter);
console.log('pxWritten/s',(rw/dt/1e6).toFixed(2)+'M','bboxPx/s',(pxIter/dt/1e6).toFixed(2)+'M','px/tri',(rw/tris).toFixed(0),'bboxPx/tri',(pxIter/tris).toFixed(0));
