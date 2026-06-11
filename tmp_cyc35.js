// Census of cycle-type ((otherModeHi>>>20)&3) at rasterizeTriangle + texrect calls.
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const realLog=console.log.bind(console);
const {ram,mmu,rcp,cpu}=buildMachine();
const ST=process.env.STATE||'';
if(ST)loadState(ST,ram,mmu,cpu,rcp);
const cens={tri:{},rect:{}};
const origTri=rcp.rasterizeTriangle.bind(rcp);
rcp.rasterizeTriangle=function(...a){const c=(this.rspState.otherModeHi>>>20)&3;cens.tri[c]=(cens.tri[c]||0)+1;return origTri(...a);};
const origRect=rcp.handleG_TEXRECT?rcp.handleG_TEXRECT.bind(rcp):null;
if(origRect)rcp.handleG_TEXRECT=function(...a){const c=(this.rspState.otherModeHi>>>20)&3;cens.rect[c]=(cens.rect[c]||0)+1;return origRect(...a);};
const t0=Date.now();const LIM=+(process.env.MS||35000);const F3D=+(process.env.STOPF3D||96);
const base=rcp.f3dTaskCount|0;
for(let s=0;;s++){cpu.step();
  if((s&0xFFFF)===0){if((rcp.f3dTaskCount|0)>=base+F3D)break;if(Date.now()-t0>LIM)break;}}
realLog('f3d',rcp.f3dTaskCount|0,'tri',JSON.stringify(cens.tri),'rect',JSON.stringify(cens.rect));
