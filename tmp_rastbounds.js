const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9,n=0,big=0;
const orig=rcp.rasterizeTriangle.bind(rcp);
rcp.rasterizeTriangle=function(a,b,c,addr){
  for(const v of [a,b,c]){if(v.x<minX)minX=v.x;if(v.x>maxX)maxX=v.x;if(v.y<minY)minY=v.y;if(v.y>maxY)maxY=v.y;
    if(Math.abs(v.x)>1000||Math.abs(v.y)>1000)big++;}
  n++; return orig(a,b,c,addr);};
// also count texrect / fillrect
let texr=0,fillr=0;
if(rcp.handleG_TEXRECT){const o=rcp.handleG_TEXRECT.bind(rcp);rcp.handleG_TEXRECT=function(...a){texr++;return o(...a);};}
const t0=Date.now();
for(let s=0;;s++){try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((s&0xFFFF)===0){if((rcp.f3dTaskCount|0)>=10)break;if(Date.now()-t0>40000)break;}}
realLog('rasterized tris',n,'vertsBeyond1000px',big);
realLog('rast bbox X['+minX.toFixed(0)+','+maxX.toFixed(0)+'] Y['+minY.toFixed(0)+','+maxY.toFixed(0)+']');
realLog('texrects',texr);
