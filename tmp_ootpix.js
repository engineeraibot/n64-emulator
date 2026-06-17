process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState('state_oot_title',ram,mmu,cpu,rcp);
let nf=0;const oP=rcp.processDisplayList.bind(rcp);
rcp.processDisplayList=function(addr,ds){const before=rcp.drawStats.pixelsWritten|0;const r=oP(addr,ds);const after=rcp.drawStats.pixelsWritten|0;if(nf<6){log('frame pixelsWritten +'+(after-before)+' tris='+(rcp.drawStats.triangles|0)+' culled='+(rcp.drawStats.culledTriangles|0)+' offscreen='+(rcp.drawStats.offscreenTriangles|0));nf++;}return r;};
const startF=rcp.f3dex2TaskCount|0;const t0=Date.now();
for(let s=0;s<200000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){if((rcp.f3dex2TaskCount|0)-startF>=8)break;if(Date.now()-t0>30000)break;}}
