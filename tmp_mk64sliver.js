// Isolate the green near-plane sliver tris in state_mk64_race.
// Reports triangles that have at least one on-screen vertex AND at least one
// vertex projected far outside the guard band (extreme screen x), with their
// clip-w signs — these are the mixed-sign-w slivers surviving the near clip.
process.env.ROM=process.env.ROM||'Mario Kart 64 (Europe) (Rev A).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_mk64_race', ram, mmu, cpu, rcp);
const log=console.error.bind(console);
const startF=rcp.f3dTaskCount|0;
const STOP=startF+parseInt(process.env.ADV||'2',10);
let auditOn=false;
let total=0, extreme=0;
const groups=new Map();
const origDraw=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(v1,v2,v3){
  if(auditOn){
    total++;
    const vs=[v1,v2,v3];
    const xs=vs.map(v=>v.x), ys=vs.map(v=>v.y);
    const cws=vs.map(v=>(v.cw!==undefined?v.cw:v.w));
    const sw=(this.rspState.colorImageWidth|0)||320;
    const anyOn = vs.some(v=>v.x>=0&&v.x<sw&&v.y>=0&&v.y<240);
    const maxAbsX = Math.max(...xs.map(Math.abs));
    // far beyond guard band (N64 guard band ~ +/-2x screen)
    if(anyOn && maxAbsX>700){
      extreme++;
      const rs=this.rspState; const tile=rs.tiles[rs.currentTile|0]||{};
      const key=['gm0x'+(rs.geometryMode>>>0).toString(16),
        'comb0x'+((rs.combine&&rs.combine.hi)>>>0).toString(16),
        'T'+(rs.useTexture?1:0)].join(' ');
      let g=groups.get(key)||{n:0,key,ex:''};
      g.n++;
      if(g.n<=3)g.ex+=`\n   x[${xs.map(x=>x.toFixed(0)).join(',')}] y[${ys.map(y=>y.toFixed(0)).join(',')}] cw[${cws.map(w=>w.toFixed(2)).join(',')}] rgb(${v1.r|0},${v1.g|0},${v1.b|0})`;
      groups.set(key,g);
    }
  }
  return origDraw(v1,v2,v3);
};
for(let s=0;s<400000000;s++){
  try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dTaskCount|0; auditOn=(f>=STOP-1); if(f>=STOP)break;}
}
log('total tris',total,'extreme-x tris',extreme);
for(const g of [...groups.values()].sort((a,b)=>b.n-a.n)) log(`n=${g.n} ${g.key}${g.ex}`);
