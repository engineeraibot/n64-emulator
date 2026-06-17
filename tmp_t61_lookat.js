process.env.ROM=process.env.ROMNAME||'Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState(process.env.INSTATE||'state_oot_scene',ram,mmu,cpu,rcp);
let texgenTris=0, totTris=0;
const oD=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(a,b,c){const on=(this.rspState.geometryMode&0x00040000)!==0;if(on)texgenTris++;totTris++;return oD(a,b,c);};
const seen=new Set();
const ADV=parseInt(process.env.ADV||'250');const startF=rcp.f3dex2TaskCount|0;const t0=Date.now();
for(let s=0;s<500000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const la=rcp.rspState&&rcp.rspState.lookat;if(la){const key=JSON.stringify(la);if(!seen.has(key)){seen.add(key);log('lookat@f'+(rcp.f3dex2TaskCount|0),key);}}
    if((rcp.f3dex2TaskCount|0)-startF>=ADV)break;if(Date.now()-t0>38000)break;}}
log('texgenTris',texgenTris,'totalTris',totTris,'distinctLookat',seen.size);
