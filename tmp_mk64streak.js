// Find triangles producing wide horizontal streaks in the upper band.
process.env.ROM=process.env.ROM||'Mario Kart 64 (Europe) (Rev A).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_mk64_race', ram, mmu, cpu, rcp);
const log=console.error.bind(console);
const startF=rcp.f3dTaskCount|0;
const STOP=startF+parseInt(process.env.ADV||'2',10);
let auditOn=false;
const groups=new Map();
let wide=0,total=0;
const origDraw=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(v1,v2,v3){
  if(auditOn){
    total++;
    const xs=[v1.x,v2.x,v3.x], ys=[v1.y,v2.y,v3.y];
    const xspan=Math.max(...xs)-Math.min(...xs);
    const ymin=Math.min(...ys), ymax=Math.max(...ys);
    // upper band, very wide horizontally, thin vertically => streak
    if(ymax<120 && xspan>200 && (ymax-ymin)<40){
      wide++;
      const rs=this.rspState; const tile=rs.tiles[rs.currentTile|0]||{};
      const key=['fmt'+(tile.format|0)+'/'+(tile.size|0),'T'+(rs.useTexture?1:0),
        'comb0x'+((rs.combine&&rs.combine.hi)>>>0).toString(16),
        'gm0x'+(rs.geometryMode>>>0).toString(16)].join(' ');
      let g=groups.get(key)||{n:0,key,ex:''};
      g.n++;
      if(g.n<=2)g.ex+=` [x ${Math.min(...xs).toFixed(0)}..${Math.max(...xs).toFixed(0)} y ${ymin.toFixed(0)}..${ymax.toFixed(0)} w ${(v1.w||v1.cw||0).toFixed(1)},${(v2.w||v2.cw||0).toFixed(1)},${(v3.w||v3.cw||0).toFixed(1)}]`;
      groups.set(key,g);
    }
  }
  return origDraw(v1,v2,v3);
};
for(let s=0;s<400000000;s++){
  try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dTaskCount|0; auditOn=(f>=STOP-1); if(f>=STOP)break;}
}
log('total tris',total,'wide-streak tris',wide);
for(const g of [...groups.values()].sort((a,b)=>b.n-a.n)) log(`n=${g.n} ${g.key}${g.ex}`);
