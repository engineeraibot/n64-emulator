const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_adv2', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
// hook projectClipToScreen to gather screen bbox + viewport seen
let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9,nTri=0;
const vpSeen=new Map();
const origProj=rcp.projectClipToScreen.bind(rcp);
rcp.projectClipToScreen=function(tx,ty,tz,tw){
  const r=origProj(tx,ty,tz,tw);
  if(rcp.rspState&&rcp.rspState.viewport){const vp=rcp.rspState.viewport;const key=vp.scale.map(x=>x.toFixed(1)).join(',')+'|'+vp.trans.map(x=>x.toFixed(1)).join(',');vpSeen.set(key,(vpSeen.get(key)||0)+1);}
  if(r.sx<minX)minX=r.sx;if(r.sx>maxX)maxX=r.sx;if(r.sy<minY)minY=r.sy;if(r.sy>maxY)maxY=r.sy;nTri++;
  return r;};
const t0=Date.now();
for(let s=0;;s++){try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((s&0xFFFF)===0){if((rcp.f3dTaskCount|0)>=8)break;if(Date.now()-t0>38000)break;}}
realLog('f3d',rcp.f3dTaskCount|0,'projCalls',nTri);
realLog('screen bbox X['+minX.toFixed(1)+','+maxX.toFixed(1)+'] Y['+minY.toFixed(1)+','+maxY.toFixed(1)+']');
realLog('--- viewports (scale|trans : count) ---');
for(const[k,n]of [...vpSeen.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8))realLog('  '+k+' : '+n);
realLog('colorImage=0x'+((rcp.rspState.colorImage|0)>>>0).toString(16),'colorImageWidth='+rcp.rspState.colorImageWidth);
