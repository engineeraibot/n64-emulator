process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.INSTATE||'state_oot_scene',ram,mmu,cpu,rcp);
let texTris=0,flatTris=0,sxs=[],sys=[];
const oD=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(a,b,c){
  if(this.rspState.useTexture)texTris++;else flatTris++;
  return oD(a,b,c);
};
const t0=Date.now();const startF=rcp.f3dex2TaskCount|0;let bs=0;
for(let s=0;s<500000000;s++){cpu.step();
  if((s&0x3FFF)===0){const f=rcp.f3dex2TaskCount|0;const ph=(f-startF)%40;let w=(ph<6)?0x1000:0;if(w!==bs){mmu.updateController(w,0,0);bs=w;}
    if(f-startF>=250)break;if(Date.now()-t0>40000)break;}}
const vp=rcp.rspState.viewport;
console.error('viewport:',vp?JSON.stringify(vp):'n/a');
console.error('textured tris:',texTris,' flat tris:',flatTris);
