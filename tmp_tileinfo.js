const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
// For big (full-screen-ish) triangles, record tile params + ts/tt span.
const origRast=rcp.rasterizeTriangle.bind(rcp);
const seen={};
rcp.rasterizeTriangle=function(v1,v2,v3,addr){
  const minX=Math.min(v1.x,v2.x,v3.x),maxX=Math.max(v1.x,v2.x,v3.x);
  const minY=Math.min(v1.y,v2.y,v3.y),maxY=Math.max(v1.y,v2.y,v3.y);
  const big=(maxX-minX)>1||(maxY-minY)>1;
  if(big && rcp.rspState.useTexture){
    const ti=rcp.rspState.currentTile, tile=rcp.rspState.tiles[ti];
    const key=ti+':'+tile.format+':'+tile.size+':'+tile.line+':mS'+tile.maskS+':mT'+tile.maskT+':shS'+tile.shiftS+':shT'+tile.shiftT;
    if(!seen[key]){seen[key]={n:0,sMin:1e9,sMax:-1e9,tMin:1e9,tMax:-1e9,
      uls:tile.uls,ult:tile.ult,lrs:tile.lrs,lrt:tile.lrt,
      scaleS:rcp.rspState.textureScaleS,scaleT:rcp.rspState.textureScaleT};}
    const o=seen[key];o.n++;
    for(const v of [v1,v2,v3]){o.sMin=Math.min(o.sMin,v.s);o.sMax=Math.max(o.sMax,v.s);o.tMin=Math.min(o.tMin,v.t);o.tMax=Math.max(o.tMax,v.t);}
  }
  return origRast(v1,v2,v3,addr);
};
rcp.f3dTaskCount=0;
const t0=Date.now();
for(let s=0;;s++){ try{cpu.step();}catch(e){break;}
  if((s&0x1FFFF)===0){ if((rcp.f3dTaskCount|0)>=2)break; if(Date.now()-t0>40000)break; } }
for(const[k,o]of Object.entries(seen)){
  realLog(k,'n='+o.n,'uls='+o.uls,'ult='+o.ult,'lrs='+o.lrs,'lrt='+o.lrt,
   'scaleS='+o.scaleS.toFixed(4),'scaleT='+o.scaleT.toFixed(4),
   's['+o.sMin.toFixed(1)+','+o.sMax.toFixed(1)+']','t['+o.tMin.toFixed(1)+','+o.tMax.toFixed(1)+']');
}
