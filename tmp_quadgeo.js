const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);console.log=()=>{};
rcp.f3dTaskCount=0;
let rec=false;const tris=[];
const orig=rcp.rasterizeTriangle.bind(rcp);
rcp.rasterizeTriangle=function(v1,v2,v3,addr){
  if(rec&&tris.length<40&&rcp.rspState.useTexture){
    tris.push([v1,v2,v3].map(v=>({x:+v.x.toFixed(1),y:+v.y.toFixed(1),s:+(v.s).toFixed(1),t:+(v.t).toFixed(1),w:+(v.w??1).toFixed(3)})));
  }
  return orig(v1,v2,v3,addr);
};
const t0=Date.now();
for(let s=0;;s++){try{cpu.step()}catch(e){break}
 if((rcp.f3dTaskCount|0)>=1)rec=true;
 if((s&0x1FFFF)===0){if((rcp.f3dTaskCount|0)>=3)break;if(Date.now()-t0>40000)break;}}
realLog('captured',tris.length,'textured tris');
realLog('scaleS',rcp.rspState.textureScaleS,'scaleT',rcp.rspState.textureScaleT);
for(let i=0;i<Math.min(12,tris.length);i++){realLog('tri'+i,JSON.stringify(tris[i]));}
