// Trace which draw call writes a wedge pixel (PX,PY).
process.env.ROM=process.env.ROM||'Mario Kart 64 (Europe) (Rev A).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_mk64_race', ram, mmu, cpu, rcp);
const log=console.error.bind(console);
const startF=rcp.f3dTaskCount|0;
const STOP=startF+parseInt(process.env.ADV||'24',10);
const PX=parseInt(process.env.PX||'160'), PY=parseInt(process.env.PY||'53');
let auditOn=false;
function inTri(x,y,a,b,c){
  const d1=(x-b.x)*(a.y-b.y)-(a.x-b.x)*(y-b.y);
  const d2=(x-c.x)*(b.y-c.y)-(b.x-c.x)*(y-c.y);
  const d3=(x-a.x)*(c.y-a.y)-(c.x-a.x)*(y-a.y);
  const neg=(d1<0)||(d2<0)||(d3<0), pos=(d1>0)||(d2>0)||(d3>0);
  return !(neg&&pos);
}
const hits=[];
const origRast=rcp.rasterizeTriangle.bind(rcp);
rcp.rasterizeTriangle=function(v1,v2,v3,addr){
  if(auditOn && inTri(PX,PY,v1,v2,v3)){
    const rs=this.rspState; const tile=rs.tiles[rs.currentTile|0]||{};
    hits.push('RAST comb0x'+((rs.combine&&rs.combine.hi)>>>0).toString(16)+'/'+((rs.combine&&rs.combine.lo)>>>0).toString(16)
      +' T'+(rs.useTexture?1:0)+' fmt'+(tile.format|0)+'/'+(tile.size|0)
      +' omLo0x'+(rs.otherModeLo>>>0).toString(16)
      +' v=('+[v1,v2,v3].map(v=>`${v.x|0},${v.y|0}:${v.r|0},${v.g|0},${v.b|0},a${v.a|0}`).join(' ')+')');
  }
  return origRast(v1,v2,v3,addr);
};
if(rcp.handleG_TEXRECT){const o=rcp.handleG_TEXRECT.bind(rcp);rcp.handleG_TEXRECT=function(...a){if(auditOn)hits.push('TEXRECT '+JSON.stringify(a.slice(0,4)));return o(...a);};}
if(rcp.handleG_FILLRECT){const o=rcp.handleG_FILLRECT.bind(rcp);rcp.handleG_FILLRECT=function(...a){if(auditOn)hits.push('FILLRECT');return o(...a);};}
for(let s=0;s<400000000;s++){
  try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dTaskCount|0; auditOn=(f>=STOP-1); if(f>=STOP)break;}
}
log('writers of pixel',PX,PY,'count',hits.length);
hits.forEach((h,i)=>log(' '+i+': '+h));
