const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_adv2', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
if(rcp.drawStats){for(const k in rcp.drawStats)rcp.drawStats[k]=0;}
rcp.f3dTaskCount=0;const t0=Date.now();
for(let s=0;;s++){try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((s&0xFFFF)===0){if((rcp.f3dTaskCount|0)>=6)break;if(Date.now()-t0>38000)break;}}
realLog('drawStats',JSON.stringify(rcp.drawStats));
realLog('f3d',rcp.f3dTaskCount|0,'taskHist',JSON.stringify(rcp.taskTypeHistogram||{}));
// also: print VI width and the scissor/origin the RDP used if tracked
realLog('rcp fields:',Object.keys(rcp).filter(k=>/scissor|origin|width|colorImage|fbWidth|fbAddr/i.test(k)).join(','));
for(const k of Object.keys(rcp).filter(k=>/scissor|colorImage|fbWidth|fbAddr|origin|width/i.test(k))){
  try{realLog('  rcp.'+k+'=',JSON.stringify(rcp[k]));}catch(e){}
}
