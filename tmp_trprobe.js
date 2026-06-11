const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_title_full', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
let shown=0;
const o=rcp.handleG_TEXRECT.bind(rcp);
rcp.handleG_TEXRECT=function(hi,lo,addr,flip,fifo){
  if(shown<3){
    shown++;
    const tile=(lo>>24)&7;
    const tl=this.rspState.tiles[tile];
    realLog('tile cfg',JSON.stringify(tl));
    realLog('combine',this.rspState.combine.hi.toString(16),this.rspState.combine.lo.toString(16),
      'omHi',(this.rspState.otherModeHi>>>0).toString(16),'omLo',(this.rspState.otherModeLo>>>0).toString(16),
      'useTex',this.rspState.useTexture,'blActive',this.blenderActive());
    const px=[];
    for(let ds=0;ds<8;ds++){const s=(1024*ds)/32; const tx=this.sampleTexture(s,2*32,tile); px.push(`${tx.r},${tx.g},${tx.b},${tx.a}`);}
    realLog('row2 texels:',px.join(' | '));
    if(this.rspState.combine.hi||this.rspState.combine.lo){
      this._setupCombine();
      const c=this.combineColor({r:255,g:255,b:255,a:255},{r:10,g:20,b:30,a:255});
      realLog('combine(white,10/20/30)=',JSON.stringify(c));
    }
  }
  return o(hi,lo,addr,flip,fifo);
};
const t0=Date.now();
for(let s=0;;s++){
  try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((s&0xFFF)===0){
    if((rcp.f3dTaskCount|0)>=20||shown>=3)break;
    if(Date.now()-t0>40000){realLog('budget');break;}
  }
}
