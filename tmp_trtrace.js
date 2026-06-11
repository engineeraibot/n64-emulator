const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_title_full', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
let on=false;
const o=rcp.handleG_TEXRECT.bind(rcp);
rcp.handleG_TEXRECT=function(hi,lo,addr,flip,fifo){
  if(on){
    const xh=(hi>>12)&0xFFF,yh=hi&0xFFF,tile=(lo>>24)&7,xl=(lo>>12)&0xFFF,yl=lo&0xFFF;
    let s0,t0,dsdx,dtdy;
    if(fifo){const w1=this.mmu.read32(Number(addr)+8),w2=this.mmu.read32(Number(addr)+12);
      s0=w1>>16;t0=(w1<<16)>>16;dsdx=w2>>16;dtdy=(w2<<16)>>16;}
    else{const w1=this.mmu.read32(Number(addr)+12),w2=this.mmu.read32(Number(addr)+20);
      s0=w1>>16;t0=(w1<<16)>>16;dsdx=w2>>16;dtdy=(w2<<16)>>16;}
    const cyc=(this.rspState.otherModeHi>>>20)&3;
    const tl=this.rspState.tiles[tile];
    realLog(`TEXRECT x=${xl>>2}..${xh>>2} y=${yl>>2}..${yh>>2} tile=${tile} s0=${s0} t0=${t0} dsdx=${dsdx} dtdy=${dtdy} cyc=${cyc} fifo=${fifo?1:0} fmt=${tl.format} sz=${tl.size} useTex=${this.rspState.useTexture?1:0}`);
  }
  return o(hi,lo,addr,flip,fifo);
};
const t0=Date.now();
for(let s=0;;s++){
  try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((s&0xFFF)===0){
    const f=rcp.f3dTaskCount|0;
    on=true;
    if(f>=20)break;
    if(Date.now()-t0>40000){realLog('budget');break;}
  }
}
