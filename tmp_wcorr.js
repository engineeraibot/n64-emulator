const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_adv2', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
let pos=[],neg=[];
const origVTX=rcp.handleG_VTX.bind(rcp);
rcp.handleG_VTX=function(hi,lo){
  origVTX(hi,lo);
  const mv=rcp.rspState.modelviewStack[rcp.rspState.modelviewStack.length-1];
  const p=rcp.rspState.projectionMatrix;
  // sample vertex 0 just written
  const verts=rcp.rspState.vertices;
  // find a written vertex with w
  for(let i=0;i<16;i++){const v=verts[i];if(!v)continue;const w=v.w;
    const rec='mvT['+mv[12].toFixed(0)+','+mv[13].toFixed(0)+','+mv[14].toFixed(0)+'] projW[11]='+p[11].toFixed(2)+' projW[15]='+p[15].toFixed(2)+' w='+w.toFixed(1);
    if(w<=0){if(neg.length<6)neg.push(rec);}else{if(pos.length<6)pos.push(rec);}
    break;}
};
const t0=Date.now();
for(let s=0;;s++){try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((s&0xFFFF)===0){if(pos.length>=6&&neg.length>=6)break;if((rcp.f3dTaskCount|0)>=8)break;if(Date.now()-t0>38000)break;}}
realLog('=== POSITIVE w verts ===');for(const r of pos)realLog(r);
realLog('=== NEGATIVE w verts ===');for(const r of neg)realLog(r);
