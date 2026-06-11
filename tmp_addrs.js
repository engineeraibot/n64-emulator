const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
const seen=new Set();
const origRast=rcp.rasterizeTriangle.bind(rcp);
let rowHist=new Array(240).fill(0);
rcp.rasterizeTriangle=function(v1,v2,v3,addr){
  const key='ci='+(rcp.rspState.colorImage>>>0).toString(16)+' di='+(rcp.rspState.depthImage>>>0).toString(16)+' w='+rcp.rspState.colorImageWidth+' depthEn='+(((rcp.rspState.geometryMode&1)!==0)&&!!rcp.rspState.depthImage);
  if(!seen.has(key)){seen.add(key);realLog('RAST',key);}
  return origRast(v1,v2,v3,addr);
};
const t0=Date.now();
for(let s=0;;s++){ try{cpu.step();}catch(e){break;}
  if((s&0x1FFFF)===0){ if((rcp.f3dTaskCount|0)>=3)break; if(Date.now()-t0>40000)break; } }
realLog('rowWrites sample:');
const rw=rcp.drawStats.rowWrites;
let line='';for(let y=0;y<240;y+=4){line+=(rw[y]>0?'#':'.');}
realLog(line);
