const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
const o=rcp.handleG_FILLRECT.bind(rcp);
const seen=new Map();
rcp.handleG_FILLRECT=function(hi,lo){
  const x2=(hi>>12)&0xFFF,y2=hi&0xFFF,x1=(lo>>12)&0xFFF,y1=lo&0xFFF;
  const k=`x=${x1>>2}..${x2>>2} y=${y1>>2}..${y2>>2} fill=0x${(this.rspState.fillColor>>>0).toString(16)} ci=0x${(this.rspState.colorImage>>>0).toString(16)}`;
  seen.set(k,(seen.get(k)||0)+1);
  return o(hi,lo);
};
const t0=Date.now();
for(let s=0;;s++){
  try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((s&0xFFF)===0){
    if((rcp.f3dTaskCount|0)>=20)break;
    if(Date.now()-t0>40000){realLog('budget');break;}
  }
}
for(const [k,n] of seen)realLog(n,k);
