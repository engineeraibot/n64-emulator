const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_adv2', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
let nW=0,wTiny=0,wNeg=0,wNorm=0; let sampleVerts=[];
const origProj=rcp.projectClipToScreen.bind(rcp);
rcp.projectClipToScreen=function(tx,ty,tz,tw){
  nW++; if(tw<=0)wNeg++; else if(Math.abs(tw)<1)wTiny++; else wNorm++;
  if(sampleVerts.length<12 && (Math.abs(tx)>5000||Math.abs(tw)<1)) sampleVerts.push([tx.toFixed(1),ty.toFixed(1),tz.toFixed(1),tw.toFixed(3)]);
  return origProj(tx,ty,tz,tw);};
const t0=Date.now();
for(let s=0;;s++){try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((s&0xFFFF)===0){if((rcp.f3dTaskCount|0)>=6)break;if(Date.now()-t0>38000)break;}}
realLog('projCalls',nW,'wNeg(<=0)',wNeg,'wTiny(|w|<1)',wTiny,'wNorm',wNorm);
realLog('sample bad clip verts [tx,ty,tz,tw]:');for(const v of sampleVerts)realLog('  ',JSON.stringify(v));
// dump current matrix stack top if available
realLog('rspState keys with matrix:',Object.keys(rcp.rspState).filter(k=>/mtx|matrix|proj|model/i.test(k)).join(','));
