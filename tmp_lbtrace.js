// Trace LOADBLOCK/LOADTILE/SETTIMG during one title frame.
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_title_fix', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
let on=false;
const oLB=rcp.handleG_LOADBLOCK.bind(rcp);
rcp.handleG_LOADBLOCK=function(hi,lo){
  if(on){
    const uls=(hi>>>12)&0xFFF, ult=hi&0xFFF, lrs=(lo>>>12)&0xFFF, dxt=lo&0xFFF;
    const rs=this.rspState;
    realLog(`LOADBLOCK uls=${uls} ult=${ult} lrs=${lrs} dxt=${dxt} timg=0x${(rs.textureImage>>>0).toString(16)} siz=${rs.textureImageSize} w=${rs.textureImageWidth}`);
  }
  return oLB(hi,lo);
};
const oLT=rcp.handleG_LOADTILE.bind(rcp);
rcp.handleG_LOADTILE=function(hi,lo){
  if(on) realLog(`LOADTILE hi=0x${(hi>>>0).toString(16)} lo=0x${(lo>>>0).toString(16)}`);
  return oLT(hi,lo);
};
const t0=Date.now();
for(let s=0;;s++){
  try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((s&0xFFF)===0){
    const f=rcp.f3dTaskCount|0;
    on = f>=1;
    if(f>=2)break;
    if(Date.now()-t0>40000){realLog('budget');break;}
  }
}
