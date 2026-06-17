process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState('state_oot_title',ram,mmu,cpu,rcp);
let cap=false;
function cyc(rs){return (rs.otherModeHi>>>20)&3;}
const oF=rcp.handleG_FILLRECT.bind(rcp);
rcp.handleG_FILLRECT=function(hi,lo){const rs=this.rspState;const x2=(hi>>>12)&0xFFF,y2=hi&0xFFF,x1=(lo>>>12)&0xFFF,y1=lo&0xFFF;
  if(cap)log('FILLRECT ci=0x'+(rs.colorImage>>>0&0x7FFFFF).toString(16)+' rect=('+(x1>>2)+','+(y1>>2)+')-('+(x2>>2)+','+(y2>>2)+') cyc='+cyc(rs)+' fill=0x'+(rs.fillColor>>>0).toString(16)+' otherHi=0x'+(rs.otherModeHi>>>0).toString(16));
  return oF(hi,lo);};
let td=0;const oD=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(a,b,c){if(cap&&td<1){log('TRIS begin ci=0x'+(this.rspState.colorImage>>>0&0x7FFFFF).toString(16)+' cyc='+cyc(this.rspState));td++;}return oD(a,b,c);};
const oS=rcp.processDisplayList.bind(rcp);
rcp.processDisplayList=function(addr,ds){const f=rcp.f3dex2TaskCount|0;if(f>=(rcp._t||1e9)&&!cap){cap=true;td=0;log('=== TASK f3dex2='+f+' ===');}const r=oS(addr,ds);if(cap){cap=false;rcp._t=1e9;}return r;};
const startF=rcp.f3dex2TaskCount|0;rcp._t=startF+3;const t0=Date.now();
for(let s=0;s<200000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){if((rcp.f3dex2TaskCount|0)-startF>=5)break;if(Date.now()-t0>30000)break;}}
