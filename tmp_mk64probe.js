// MK64 multi-frame diagnostic probe.
process.env.ROM = process.env.ROM || 'Mario Kart 64 (Europe) (Rev A).n64';
const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);

// Instrument: count tris, textured tris, distinct combiners, texcoord ranges per task.
let stat=null;
function resetStat(){stat={tris:0,texTris:0,sZero:0,sNon:0,combos:{},tiles:{},cimg:0,fmt:{}};}
resetStat();

const origDraw=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(a,b,c){
  stat.tris++;
  const useTex = this.rspState.useTexture || this.rspState.textureEnabled;
  if(useTex)stat.texTris++;
  // texcoord magnitude
  const sm=Math.abs(a.s)+Math.abs(b.s)+Math.abs(c.s)+Math.abs(a.t)+Math.abs(b.t)+Math.abs(c.t);
  if(sm===0)stat.sZero++;else stat.sNon++;
  const key=(this.rspState.combine.hi>>>0).toString(16)+':'+(this.rspState.combine.lo>>>0).toString(16);
  stat.combos[key]=(stat.combos[key]||0)+1;
  return origDraw(a,b,c);
};

const STOP=parseInt(process.env.STOPF3D||'120',10);
const MAXSTEP=parseInt(process.env.MAXSTEP||'120000000',10);
let lastF3d=0;const perTask=[];
const t0=Date.now();
for(let s=0;s<MAXSTEP;s++){
  try{cpu.step();}catch(e){log('THREW',s,e.message);break;}
  if((s&0x3FFF)===0){
    const f=rcp.f3dTaskCount|0;
    if(f!==lastF3d){
      // a new task boundary passed; record stat of the task just finished
      perTask.push({f:lastF3d,...stat});
      resetStat();
      lastF3d=f;
    }
    if(f>=STOP){log('reached f3d',f,'step',s);break;}
    if(Date.now()-t0>40000){log('[budget]',s,'f3d',f);break;}
  }
}
log('=== ucode:',rcp.rspState&&rcp.rspState.ucodeName,'idxScale',rcp.rspState&&rcp.rspState.triIndexScale,
    'isEX2',rcp.rspState&&rcp.rspState.isF3DEX2);
log('f3dTasks',rcp.f3dTaskCount,'rspTasks',rcp.rspTaskCount,'audioTasks',rcp.audioTasksRun|0);
// Summarize tasks with most tris
perTask.sort((a,b)=>b.tris-a.tris);
log('--- top tasks by tris ---');
for(const t of perTask.slice(0,8)){
  const combos=Object.entries(t.combos).sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]+'('+x[1]+')').join(' ');
  log(`f3d${t.f}: tris=${t.tris} texTris=${t.texTris} sZero=${t.sZero} sNon=${t.sNon} combos=[${combos}]`);
}
const best=rcp.bestRichVideoSnapshot;
log('bestRich:',best?('origin=0x'+(best.origin>>>0).toString(16)+' w='+best.width+' t='+best.type+' nonBlack='+best.nonBlack):'none');
log('displayed:',rcp.displayedFrameSnapshot?('nonBlack='+rcp.displayedFrameSnapshot.nonBlack):'none');
