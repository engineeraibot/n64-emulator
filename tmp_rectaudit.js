// Audit per-texrect render state for one frame from a saved state.
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_fileselect', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
const STOPF3D=parseInt(process.env.STOPF3D||'3',10);
let auditOn=false, idx=0;
const orig=rcp.handleG_TEXRECT.bind(rcp);
rcp.handleG_TEXRECT=function(hi,lo,addr,flip,isRdpFifo){
  if(auditOn){
    const rs=this.rspState;
    const xh=(hi>>12)&0xFFF, yh=hi&0xFFF, tileN=(lo>>24)&7, xl=(lo>>12)&0xFFF, yl=lo&0xFFF;
    const tile=rs.tiles[tileN]||{};
    const cyc=(rs.otherModeHi>>>20)&3;
    let s0,t0,dsdx,dtdy;
    if(isRdpFifo){const w1hi=this.mmu.read32(Number(addr)+8),w1lo=this.mmu.read32(Number(addr)+12);
      s0=w1hi>>16;t0=(w1hi<<16)>>16;dsdx=w1lo>>16;dtdy=(w1lo<<16)>>16;}
    else{const w1lo=this.mmu.read32(Number(addr)+12),w2lo=this.mmu.read32(Number(addr)+20);
      s0=w1lo>>16;t0=(w1lo<<16)>>16;dsdx=w2lo>>16;dtdy=(w2lo<<16)>>16;}
    // sample center texel
    const w=(xh-xl)>>2,h=(yh-yl)>>2;
    const sStep=(cyc===2)?(dsdx/4):dsdx;
    const sc=s0+(sStep*(w/2))/32, tc=t0+(dtdy*(h/2))/32;
    let tx={r:-1,g:-1,b:-1,a:-1};
    try{ if(rs.useTexture) tx=this.sampleTexture(sc,tc,tileN);}catch(e){}
    realLog(`#${idx++} px(${xl>>2},${yl>>2})-(${xh>>2},${yh>>2}) tile${tileN} fmt${tile.format|0} sz${tile.size|0} cyc${cyc} useTex${rs.useTexture?1:0} s0=${s0} t0=${t0} dsdx=${dsdx} dtdy=${dtdy} comb=${(rs.combine.hi>>>0).toString(16)},${(rs.combine.lo>>>0).toString(16)} omLo=${(rs.otherModeLo>>>0).toString(16)} ctrTexel=(${tx.r},${tx.g},${tx.b},${tx.a}) prim=(${rs.primColor?[rs.primColor.r,rs.primColor.g,rs.primColor.b,rs.primColor.a]:'-'}) env=(${rs.envColor?[rs.envColor.r,rs.envColor.g,rs.envColor.b,rs.envColor.a]:'-'})`);
  }
  return orig(hi,lo,addr,flip,isRdpFifo);
};
const t0n=Date.now();
for(let s=0;;s++){
  try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
  if((s&0xFFF)===0){
    const f=rcp.f3dTaskCount|0;
    auditOn=f>=STOPF3D-1;
    if(f>=STOPF3D){realLog('reached f3d',f);break;}
    if(Date.now()-t0n>40000){realLog('[budget]',f);break;}
  }
}
