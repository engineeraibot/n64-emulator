// Trace the near-plane clip output for the green wedge tris.
process.env.ROM=process.env.ROM||'Mario Kart 64 (Europe) (Rev A).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_mk64_race', ram, mmu, cpu, rcp);
const log=console.error.bind(console);
const startF=rcp.f3dTaskCount|0;
const STOP=startF+parseInt(process.env.ADV||'24',10);
let auditOn=false, shown=0;
const origDraw=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(v1,v2,v3){
  if(auditOn && shown<8){
    const vs=[v1,v2,v3];
    const cws=vs.map(v=>(v.cw!==undefined?v.cw:v.w));
    const grn=vs.some(v=>v.g>70 && v.g>v.r+30 && v.g>v.b+30);
    const mixed=(Math.min(...cws)<0 && Math.max(...cws)>0);
    if(grn && mixed){
      shown++;
      log('--- green mixed-cw tri ---');
      vs.forEach((v,i)=>log(`  in v${i}: cx=${(v.cx??v.x).toFixed(1)} cy=${(v.cy??v.y).toFixed(1)} cz=${(v.cz??v.z).toFixed(1)} cw=${cws[i].toFixed(2)} screen(${v.x.toFixed(0)},${v.y.toFixed(0)})`));
      const clipped=this.clipTriangleNearPlane(v1,v2,v3);
      log('  clipped poly verts:',clipped.length);
      clipped.forEach((v,i)=>{
        const p=v._needsProject?this.projectClipToScreen(v.cx,v.cy,v.cz,v.cw):{sx:v.x,sy:v.y,sz:v.z};
        log(`    c${i}: cw=${(v.cw??v.w).toFixed(2)} -> screen(${p.sx.toFixed(0)},${p.sy.toFixed(0)}) new=${!!v._needsProject}`);
      });
    }
  }
  return origDraw(v1,v2,v3);
};
for(let s=0;s<400000000;s++){
  try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dTaskCount|0; auditOn=(f>=STOP-1); if(f>=STOP)break;}
}
log('done, shown',shown);
