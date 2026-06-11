const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_game12', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
let auditOn=false;
const mmCounts=new Map(); const mwCounts=new Map();
const origMM=rcp.handleG_MOVEMEM.bind(rcp);
rcp.handleG_MOVEMEM=function(hi,lo){
  if(auditOn){const idx=(hi>>>16)&0xFF;const k='idx0x'+idx.toString(16)+'_len'+(hi&0xFFFF);
    mmCounts.set(k,(mmCounts.get(k)||0)+1);}
  return origMM(hi,lo);
};
const origMW=rcp.handleG_MOVEWORD.bind(rcp);
rcp.handleG_MOVEWORD=function(hi,lo){
  if(auditOn){let index;if(this.rspState.isF3DEX2){index=(hi>>>16)&0xFF;}else{index=hi&0xFF;}
    if(index===2){const k='numlight_raw'+(lo>>>0);mwCounts.set(k,(mwCounts.get(k)||0)+1);}}
  return origMW(hi,lo);
};
let fallback=0, configured=0, samples=[];
const origCLS=rcp.computeLitShade.bind(rcp);
rcp.computeLitShade=function(nx,ny,nz){
  if(auditOn){
    const lights=this.rspState.lights,n=this.rspState.numLights|0;
    if(lights&&n>0&&lights[n]){configured++;
      if(samples.length<6&&Math.random()<0.01)samples.push(JSON.stringify({n,l0:lights[0],amb:lights[n]}));}
    else {fallback++;
      if(samples.length<6&&Math.random()<0.01)samples.push('FB n='+n+' lights='+JSON.stringify(lights&&lights.slice(0,3)));}
  }
  return origCLS(nx,ny,nz);
};
const t0n=Date.now();
for(let s=0;;s++){
  try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((s&0xFFF)===0){const f=rcp.f3dTaskCount|0;auditOn=f>=2;
    if(f>=3||Date.now()-t0n>40000){realLog('done f3d',f);break;}}
}
realLog('MOVEMEM:',[...mmCounts.entries()].map(([k,v])=>k+'x'+v).join(' '));
realLog('MOVEWORD numlight:',[...mwCounts.entries()].map(([k,v])=>k+'x'+v).join(' '));
realLog('litShade fallback',fallback,'configured',configured);
for(const s of samples)realLog('sample',s);
