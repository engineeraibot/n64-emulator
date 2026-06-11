// Who writes pixel (PX,PY) in buffer ORIGIN? Logs draw command + color.
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
const PX=parseInt(process.env.PX||'20'),PY=parseInt(process.env.PY||'227');
const rd=new DataView(mmu.memory.rdram);
let nlog=0;
function watch(tag){
  return function(...args){
    const ci=this.rspState.colorImage>>>0, w=this.rspState.colorImageWidth|0;
    const p=(ci+(PY*w+PX)*2)&0x7FFFFF;
    const before=rd.getUint16(p,false);
    const r=watch.orig[tag].apply(this,args);
    const after=rd.getUint16(p,false);
    if(before!==after&&nlog<40){nlog++;
      realLog(tag,'ci=0x'+ci.toString(16),'val','0x'+before.toString(16),'->','0x'+after.toString(16),
        'omHi=0x'+(this.rspState.otherModeHi>>>0).toString(16),'tex='+(this.rspState.useTexture?1:0),
        'f3d',rcp.f3dTaskCount|0);
    }
    return r;
  };
}
watch.orig={};
for(const tag of ['handleG_TEXRECT','handleG_FILLRECT','drawTriangle']){
  watch.orig[tag]=rcp[tag].bind(rcp);
  rcp[tag]=watch(tag);
}
const t0=Date.now();
for(let s=0;;s++){
  try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((s&0xFFF)===0){
    if((rcp.f3dTaskCount|0)>=20)break;
    if(Date.now()-t0>40000){realLog('budget');break;}
  }
}
realLog('done, logged',nlog);
