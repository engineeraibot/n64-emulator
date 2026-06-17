// Probe: characterize triangles drawn in the upper screen region (skybox) of a state.
process.env.ROM=process.env.ROM||'Mario Kart 64 (Europe) (Rev A).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_mk64_race', ram, mmu, cpu, rcp);
const log=console.error.bind(console);
const startF=rcp.f3dTaskCount|0;
const STOP=startF+parseInt(process.env.ADV||'1',10);
const YMAX=parseInt(process.env.YMAX||'80',10);
const groups=new Map();
let auditOn=false;
const origDraw=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(v1,v2,v3){
  if(auditOn){
    const ys=[v1.y,v2.y,v3.y];
    if(Math.min(...ys)<YMAX && Math.max(...ys)<160){
      const rs=this.rspState;
      const tile=rs.tiles[rs.currentTile|0]||{};
      const key=[rs.useTexture?'T':'-',tile.format|0,tile.size|0,'line'+(tile.line|0),
        'cm'+(tile.cmS|0)+'/'+(tile.cmT|0),
        'gm0x'+(rs.geometryMode>>>0).toString(16),
        'cyc'+(((rs.otherModeHi>>>20)&3)),
        'comb0x'+((rs.combine&&rs.combine.hi)>>>0).toString(16)].join(' ');
      let g=groups.get(key);
      if(!g){g={n:0,key,smin:1e9,smax:-1e9,tmin:1e9,tmax:-1e9,ssS:rs.textureScaleS,ssT:rs.textureScaleT};groups.set(key,g);}
      g.n++;
      for(const v of [v1,v2,v3]){g.smin=Math.min(g.smin,v.s);g.smax=Math.max(g.smax,v.s);g.tmin=Math.min(g.tmin,v.t);g.tmax=Math.max(g.tmax,v.t);}
    }
  }
  return origDraw(v1,v2,v3);
};
for(let s=0;s<400000000;s++){
  try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dTaskCount|0; auditOn=(f>=STOP-1); if(f>=STOP)break;}
}
const arr=[...groups.values()].sort((a,b)=>b.n-a.n);
for(const g of arr){
  log(`n=${g.n}  ${g.key}  s[${g.smin.toFixed(0)}..${g.smax.toFixed(0)}] t[${g.tmin.toFixed(0)}..${g.tmax.toFixed(0)}] ssS=${g.ssS} ssT=${g.ssT}`);
}
log('groups',arr.length);
