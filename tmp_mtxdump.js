const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_adv2', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
const fmt=(m)=>'['+m.map(x=>x.toFixed(3)).join(',')+']';
let dumped=0;
const origVTX=rcp.handleG_VTX.bind(rcp);
let capProj=null, capMV=null, capFlag=null;
const origMTX=rcp.handleG_MTX.bind(rcp);
rcp.handleG_MTX=function(hi,lo){ const f=(hi>>>16)&0xFF; origMTX(hi,lo); };
// hook projectClip to detect bad vertex and dump the matrices that produced it
const origProj=rcp.projectClipToScreen.bind(rcp);
rcp.projectClipToScreen=function(tx,ty,tz,tw){
  if(dumped<4 && tw<=0){
    dumped++;
    realLog('--- bad vert tw='+tw.toFixed(3)+' tx='+tx.toFixed(1)+' ---');
    realLog(' proj='+fmt(rcp.rspState.projectionMatrix));
    const mv=rcp.rspState.modelviewStack[rcp.rspState.modelviewStack.length-1];
    realLog(' mvTop='+fmt(mv));
    realLog(' stackDepth='+rcp.rspState.modelviewStack.length);
    const mvp=rcp.multiplyMatrices(mv,rcp.rspState.projectionMatrix);
    realLog(' mvp='+fmt(mvp));
  }
  return origProj(tx,ty,tz,tw);};
const t0=Date.now();
for(let s=0;;s++){try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((s&0xFFFF)===0){if(dumped>=4)break;if((rcp.f3dTaskCount|0)>=8)break;if(Date.now()-t0>38000)break;}}
realLog('done f3d',rcp.f3dTaskCount|0,'isF3DEX2',rcp.rspState.isF3DEX2);
