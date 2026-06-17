// Count per-frame allocations in handleG_VTX/computeLitShade on a lit state.
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const STATE=process.env.STATE||'state_playable';
loadState(STATE,ram,mmu,cpu,rcp);
let vtxObjs=0, sliceCalls=0, litCalls=0, vtxCalls=0;
const origVtx=rcp.handleG_VTX.bind(rcp);
rcp.handleG_VTX=function(hi,lo){
  vtxCalls++;
  let num;
  if(this.rspState.isF3DEX2) num=(hi>>12)&0xFF;
  else if(this.rspState.triIndexScale===2) num=((hi&0xFFFF)>>>10)&0x3F;
  else num=((hi&0xFFFF)>>>4)&0x3F;
  if(num>0) vtxObjs+=num;
  return origVtx(hi,lo);
};
const origLit=rcp.computeLitShade.bind(rcp);
rcp.computeLitShade=function(nx,ny,nz){
  litCalls++;
  const lights=this.rspState.lights, n=this.rspState.numLights|0;
  if(lights && n>0 && lights[n]) sliceCalls++;
  return origLit(nx,ny,nz);
};
// run until we've processed a few frames worth of f3d tasks
const startF3d=rcp.f3dTaskCount|0;
let steps=0;
while((rcp.f3dTaskCount|0) < startF3d+3 && steps<60000000){cpu.step();steps++;}
const frames=(rcp.f3dTaskCount|0)-startF3d;
console.log('STATE',STATE,'frames',frames,'steps',steps);
console.log('handleG_VTX calls',vtxCalls,'-> vertex objects allocated',vtxObjs);
console.log('computeLitShade calls',litCalls,'-> lights.slice() arrays allocated',sliceCalls,'(+',litCalls,'{r,g,b} return objs)');
console.log('per-frame: ~',Math.round(vtxObjs/Math.max(1,frames)),'vtx objs,',Math.round(sliceCalls/Math.max(1,frames)),'slice arrays,',Math.round(litCalls/Math.max(1,frames)),'shade objs');
