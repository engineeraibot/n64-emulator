process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.INSTATE||'state_oot_scene',ram,mmu,cpu,rcp);
let total=0, shadeMattered=0;
const modes=new Map();
const oC=rcp.combineColor.bind(rcp);
rcp.combineColor=function(shade,tex){
  const a=oC(shade,tex);
  const b=oC({r:0,g:0,b:0,a:shade.a},tex);
  total++;
  if(a.r!==b.r||a.g!==b.g||a.b!==b.b)shadeMattered++;
  const key=(this.rspState.combine.hi>>>0).toString(16)+'/'+(this.rspState.combine.lo>>>0).toString(16);
  modes.set(key,(modes.get(key)||0)+1);
  return a;
};
const t0=Date.now();const startF=rcp.f3dex2TaskCount|0;let bs=0;
for(let s=0;s<500000000;s++){cpu.step();
  if((s&0x3FFF)===0){const f=rcp.f3dex2TaskCount|0;const ph=(f-startF)%40;let w=(ph<6)?0x1000:0;if(w!==bs){mmu.updateController(w,0,0);bs=w;}
    if(f-startF>=120)break;if(Date.now()-t0>35000)break;}}
console.error('combine calls',total,'shade-mattered(color)',shadeMattered,(100*shadeMattered/Math.max(1,total)).toFixed(1)+'%');
console.error('distinct combine modes:');
[...modes.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12).forEach(([k,v])=>console.error(' ',k,v));
