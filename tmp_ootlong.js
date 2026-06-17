process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {saveState,loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
if(process.env.INSTATE)loadState(process.env.INSTATE,ram,mmu,cpu,rcp);
let maxTris=0,maxF=0,curTris=0;
const oP=rcp.processDisplayList.bind(rcp);
rcp.drawTriangle=(function(o){return function(a,b,c){curTris++;return o(a,b,c);};})(rcp.drawTriangle.bind(rcp));
rcp.processDisplayList=function(addr,ds){curTris=0;const r=oP(addr,ds);if(curTris>maxTris){maxTris=curTris;maxF=rcp.f3dex2TaskCount|0;}return r;};
const startF=rcp.f3dex2TaskCount|0;const t0=Date.now();let bs=0;
for(let s=0;s<900000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dex2TaskCount|0;
    // cycle Start press every 40 frames
    const ph=(f-startF)%40;let w=(ph<6)?0x1000:0;if(w!==bs){mmu.updateController(w,0,0);bs=w;}
    if(f-startF>=parseInt(process.env.ADV||'1500'))break;if(Date.now()-t0>34000)break;}}
if(process.env.OUTSTATE)saveState(process.env.OUTSTATE,ram,mmu,cpu,rcp);
log('advanced to f3dex2',rcp.f3dex2TaskCount,'maxTris/task='+maxTris+' atF'+maxF);
