process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState('state_oot_title',ram,mmu,cpu,rcp);
let n=0,pixWritten=0,pixTested=0;
const oD=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(a,b,c){
  if(n<3){
    const rs=this.rspState;
    log('--- TRI '+n+' ---');
    log('comb.hi=0x'+(rs.combine.hi>>>0).toString(16)+' comb.lo=0x'+(rs.combine.lo>>>0).toString(16));
    log('prim=0x'+(rs.primColor>>>0).toString(16)+' env=0x'+(rs.envColor>>>0).toString(16)+' blend=0x'+(rs.blendColor>>>0).toString(16));
    log('otherModeLo=0x'+(rs.otherModeLo>>>0).toString(16)+' otherModeHi=0x'+(rs.otherModeHi>>>0).toString(16));
    log('shade A: a.a='+a.a+' b.a='+b.a+' c.a='+c.a+' z:'+a.z.toFixed(3)+' depthEn='+(((rs.otherModeLo>>>5)&1)));
    log('blenderActive='+this.blenderActive());
    if(this._setupCombine)this._setupCombine();
    const out=this.combineColor({r:a.r,g:a.g,b:a.b,a:a.a},{r:255,g:255,b:255,a:255});
    log('combineColor(shade,white)='+JSON.stringify(out));
    n++;
  }
  return oD(a,b,c);
};
const startF=rcp.f3dex2TaskCount|0;const t0=Date.now();
for(let s=0;s<200000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){if((rcp.f3dex2TaskCount|0)-startF>=2)break;if(Date.now()-t0>30000)break;}}
log('done');
