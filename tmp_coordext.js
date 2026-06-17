// Measure projected screen-coord extremes of triangles reaching the rasterizer fan.
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE, ram, mmu, cpu, rcp);
const log=console.error.bind(console);
const STOP=(rcp.f3dTaskCount|0)+parseInt(process.env.ADV||'3',10);
let auditOn=false;
let maxX=-1e9,minX=1e9,maxY=-1e9,minY=1e9,wide=0,tot=0;
const origRaster=rcp.rasterizeTriangle?rcp.rasterizeTriangle.bind(rcp):null;
// hook drawTriangle to inspect the projected screenPoly via re-doing near clip+project
const origDraw=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(v1,v2,v3){
  if(auditOn){
    const cc=this.clipTriangleNearPlane(v1,v2,v3);
    if(cc.length>=3){
      for(const v of cc){
        let sx,sy;
        if(v._needsProject){const p=this.projectClipToScreen(v.cx,v.cy,v.cz,v.cw);sx=p.sx;sy=p.sy;}
        else {sx=v.x;sy=v.y;}
        if(sx>maxX)maxX=sx;if(sx<minX)minX=sx;if(sy>maxY)maxY=sy;if(sy<minY)minY=sy;
        tot++;
        if(sx>700||sx<-400||sy>500||sy<-300)wide++;
      }
    }
  }
  return origDraw(v1,v2,v3);
};
for(let s=0;s<400000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dTaskCount|0;auditOn=(f>=STOP-1);if(f>=STOP)break;}}
log(process.env.STATE,'projected: x['+minX.toFixed(0)+'..'+maxX.toFixed(0)+'] y['+minY.toFixed(0)+'..'+maxY.toFixed(0)+'] vertsBeyondBand='+wide+'/'+tot);
