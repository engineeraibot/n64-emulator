const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_bobpaint', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
const STOPF3D=parseInt(process.env.STOPF3D||'3',10);
let on=false;let tri=0;
const origDraw=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(v1,v2,v3){
  if(on){
    tri++;
    const rs=this.rspState;const t=rs.tiles[rs.currentTile|0]||{};
    const xs=[v1.x,v2.x,v3.x].map(v=>v.toFixed(0)),ys=[v1.y,v2.y,v3.y].map(v=>v.toFixed(0));
    // only log "interesting" tris: big ones or weird tile
    const minx=Math.min(...[v1.x,v2.x,v3.x]),maxx=Math.max(...[v1.x,v2.x,v3.x]);
    const miny=Math.min(...[v1.y,v2.y,v3.y]),maxy=Math.max(...[v1.y,v2.y,v3.y]);
    if((maxx-minx)*(maxy-miny)>3000 || (t.format===3&&t.size===1)){
      realLog(`tri#${tri} tile=${rs.currentTile} fmt${t.format} sz${t.size} ${t.line|0}L tmem=${t.tmem|0} en=${rs.textureEnabled?1:0} use=${rs.useTexture?1:0} cmb=${(rs.combine.hi>>>0).toString(16)}/${(rs.combine.lo>>>0).toString(16)} omL=${(rs.otherModeLo>>>0).toString(16)} bbox=(${minx.toFixed(0)},${miny.toFixed(0)})-(${maxx.toFixed(0)},${maxy.toFixed(0)}) shade=(${v1.r},${v1.g},${v1.b},${v1.a}) st=(${(v1.s*rs.textureScaleS).toFixed(1)},${(v1.t*rs.textureScaleT).toFixed(1)})`);
    }
  }
  return origDraw(v1,v2,v3);
};
const origSetTile=rcp.handleG_SETTILE.bind(rcp);
rcp.handleG_SETTILE=function(hi,lo){
  if(on){const t=(lo>>24)&7;realLog(`  SETTILE t=${t} fmt=${(hi>>21)&7} sz=${(hi>>19)&3} line=${(hi>>9)&0x1FF} tmem=${hi&0x1FF}`);}
  return origSetTile(hi,lo);
};
const origLB=rcp.handleG_LOADBLOCK.bind(rcp);
rcp.handleG_LOADBLOCK=function(hi,lo){
  if(on){const rs=this.rspState;realLog(`  LOADBLOCK t=${(lo>>24)&7} img=0x${(rs.textureImage>>>0).toString(16)} w=${rs.textureImageWidth} sz=${rs.textureImageSize} lrs=${(lo>>>12)&0xFFF}`);}
  return origLB(hi,lo);
};
const t0=Date.now();
for(let s=0;;s++){
  try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
  if((s&0xFFF)===0){
    const f=rcp.f3dTaskCount|0;
    on = f>=STOPF3D-1;
    if(f>=STOPF3D){realLog('reached f3d',f);break;}
    if(Date.now()-t0>40000){realLog('[budget]',f);break;}
  }
}
