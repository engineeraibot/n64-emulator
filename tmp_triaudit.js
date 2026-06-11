// Audit per-triangle render state for a frame rendered from a saved state.
// Groups triangles by (combine hi/lo, useTexture, tile fmt/size, geomMode-lighting)
// and reports avg vertex shade + sampled centroid texel for each group.
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_title_fix', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
const STOPF3D=parseInt(process.env.STOPF3D||'2',10);
const groups=new Map();
let auditOn=false;
const origDraw=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(v1,v2,v3){
  if(auditOn){
    const rs=this.rspState;
    const tile=rs.tiles[rs.currentTile|0]||{};
    const key=[rs.combine.hi>>>0,rs.combine.lo>>>0,rs.useTexture?1:0,tile.format|0,tile.size|0,
      (rs.geometryMode>>>0).toString(16),(rs.otherModeLo>>>0).toString(16),(rs.otherModeHi>>>0).toString(16)].join('|');
    let g=groups.get(key);
    if(!g){g={n:0,sr:0,sg:0,sb:0,sa:0,tr:0,tg:0,tb:0,ta:0,key,fmt:tile.format|0,sz:tile.size|0};groups.set(key,g);}
    g.n++;
    g.sr+=(v1.r+v2.r+v3.r)/3; g.sg+=(v1.g+v2.g+v3.g)/3; g.sb+=(v1.b+v2.b+v3.b)/3; g.sa+=(v1.a+v2.a+v3.a)/3;
    if(rs.useTexture){
      try{
        const s=(v1.s+v2.s+v3.s)/3*rs.textureScaleS, t=(v1.t+v2.t+v3.t)/3*rs.textureScaleT;
        const tx=this.sampleTexture(s,t,rs.currentTile);
        g.tr+=tx.r; g.tg+=tx.g; g.tb+=tx.b; g.ta+=tx.a;
      }catch(e){}
    }
  }
  return origDraw(v1,v2,v3);
};
// turn audit on for the LAST f3d task before stop: simplest = audit all tasks after the first
const t0=Date.now();
for(let s=0;;s++){
  try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
  if((s&0xFFF)===0){
    const f=rcp.f3dTaskCount|0;
    auditOn = f>=STOPF3D-1;
    if(f>=STOPF3D){realLog('reached f3d',f,'steps',s);break;}
    if(Date.now()-t0>40000){realLog('[budget] f3d',f);break;}
  }
}
const arr=[...groups.values()].sort((a,b)=>b.n-a.n);
for(const g of arr){
  const f=x=>(x/g.n).toFixed(0);
  realLog(`n=${g.n} key=${g.key}`);
  realLog(`   shade avg rgba=(${f(g.sr)},${f(g.sg)},${f(g.sb)},${f(g.sa)}) texel avg rgba=(${f(g.tr)},${f(g.tg)},${f(g.tb)},${f(g.ta)})`);
}
