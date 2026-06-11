const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_adv2', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
const tr=(m)=>'t['+m[12].toFixed(0)+','+m[13].toFixed(0)+','+m[14].toFixed(0)+'] rot['+m[0].toFixed(2)+','+m[5].toFixed(2)+','+m[10].toFixed(2)+']';
let log=[];
const origMTX=rcp.handleG_MTX.bind(rcp);
rcp.handleG_MTX=function(hi,lo){
  const f=(hi>>>16)&0xFF;
  const m=rcp.readMatrix(rcp.resolveAddress(lo));
  const proj=(f&0x01)!==0;
  const isPush=rcp.rspState.isF3DEX2?((f&0x01)!==0):((f&0x04)===0);
  const load=(f&0x02)!==0;
  if(log.length<40)log.push('MTX f=0x'+f.toString(16)+(proj?' PROJ':' MV')+(load?' LOAD':' MUL')+(proj?'':(isPush?' PUSH':' NOPUSH'))+' '+tr(m));
  origMTX(hi,lo);
};
let started=false,frameDone=false;
const origVTX=rcp.handleG_VTX.bind(rcp);
const t0=Date.now();
for(let s=0;;s++){try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((s&0xFFFF)===0){if(log.length>=40)break;if((rcp.f3dTaskCount|0)>=2)break;if(Date.now()-t0>38000)break;}}
realLog('=== G_MTX sequence (one frame), isF3DEX2='+rcp.rspState.isF3DEX2+' ===');
for(const l of log)realLog(l);
realLog('final stackDepth',rcp.rspState.modelviewStack.length);
