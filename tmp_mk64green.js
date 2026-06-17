// Capture the large green wedge tris in state_mk64_race (settled frame).
process.env.ROM=process.env.ROM||'Mario Kart 64 (Europe) (Rev A).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_mk64_race', ram, mmu, cpu, rcp);
const log=console.error.bind(console);
const startF=rcp.f3dTaskCount|0;
const STOP=startF+parseInt(process.env.ADV||'24',10);
let auditOn=false, total=0, hits=0;
const groups=new Map();
const origDraw=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(v1,v2,v3){
  if(auditOn){
    total++;
    const vs=[v1,v2,v3];
    const xs=vs.map(v=>v.x), ys=vs.map(v=>v.y);
    const cws=vs.map(v=>(v.cw!==undefined?v.cw:v.w));
    // signed screen area
    const area=Math.abs((v2.x-v1.x)*(v3.y-v1.y)-(v3.x-v1.x)*(v2.y-v1.y))/2;
    // green dominant on at least one vertex
    const grn=vs.some(v=>v.g>70 && v.g>v.r+30 && v.g>v.b+30);
    // spans upper center, biggish
    const minY=Math.min(...ys), maxY=Math.max(...ys);
    if(grn && area>1500 && minY<140){
      hits++;
      const rs=this.rspState; const tile=rs.tiles[rs.currentTile|0]||{};
      const key=['gm0x'+(rs.geometryMode>>>0).toString(16),
        'comb0x'+((rs.combine&&rs.combine.hi)>>>0).toString(16),
        'T'+(rs.useTexture?1:0),'fmt'+(tile.format|0)+'/'+(tile.size|0)].join(' ');
      let g=groups.get(key)||{n:0,key,ex:''};
      g.n++;
      if(g.n<=4)g.ex+=`\n   area${area.toFixed(0)} x[${xs.map(x=>x.toFixed(0)).join(',')}] y[${ys.map(y=>y.toFixed(0)).join(',')}] cw[${cws.map(w=>w.toFixed(2)).join(',')}] rgb(${v1.r|0},${v1.g|0},${v1.b|0}) a${v1.a|0}`;
      groups.set(key,g);
    }
  }
  return origDraw(v1,v2,v3);
};
for(let s=0;s<400000000;s++){
  try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dTaskCount|0; auditOn=(f>=STOP-1); if(f>=STOP)break;}
}
log('total tris',total,'green-wedge hits',hits);
for(const g of [...groups.values()].sort((a,b)=>b.n-a.n)) log(`n=${g.n} ${g.key}${g.ex}`);
