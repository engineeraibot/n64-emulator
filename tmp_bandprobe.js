const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
console.log=()=>{};
const STOPF3D=parseInt(process.env.STOPF3D||'3',10);
rcp.f3dTaskCount=0;
let recording=false, lastTex=null;
const recs=[];
const origSample=rcp.sampleTexture.bind(rcp);
const origCombine=rcp.combineColor.bind(rcp);
rcp.sampleTexture=function(s,t,ti){const r=origSample(s,t,ti);if(recording)lastTex={s,t,a:r.a};return r;};
rcp.combineColor=function(shade,tex){const c=origCombine(shade,tex);
  if(recording&&recs.length<300000){
    recs.push({ta:tex.a,ca:c.a,cr:c.r,cg:c.g,cb:c.b,
      hi:rcp.rspState.combine.hi>>>0,lo:rcp.rspState.combine.lo>>>0,
      oml:rcp.rspState.otherModeLo>>>0,omh:(rcp.rspState.otherModeHi>>>0)||0});}
  return c;};
const t0=Date.now();
for(let s=0;;s++){try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((rcp.f3dTaskCount|0)>=1&&!recording)recording=true;
  if((s&0x1FFFF)===0){if((rcp.f3dTaskCount|0)>=STOPF3D)break;if(Date.now()-t0>40000){realLog('[budget]');break;}}}
realLog('records',recs.length);
// group by combiner
const grp={};
for(const r of recs){const k='hi='+r.hi.toString(16)+' lo='+r.lo.toString(16)+' oml='+r.oml.toString(16);
  if(!grp[k])grp[k]={n:0,transp:0,transpBlackOut:0,transpOpaqueAlpha:0};
  const g=grp[k];g.n++;if(r.ta<1){g.transp++;if((r.cr+r.cg+r.cb)===0)g.transpBlackOut++;if(r.ca>=128)g.transpOpaqueAlpha++;}}
for(const k of Object.keys(grp).sort((a,b)=>grp[b].n-grp[a].n)){const g=grp[k];
  realLog(k);realLog('   n='+g.n,'transpTexel='+g.transp,'->blackOut='+g.transpBlackOut,'->alphaStill>=128='+g.transpOpaqueAlpha);}
