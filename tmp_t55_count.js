process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState(process.env.INSTATE||'state_oot_probe3',ram,mmu,cpu,rcp);
let tris=0,texr=0,fillr=0,perTaskTris=[];
let curTris=0;
const oD=rcp.drawTriangle.bind(rcp); rcp.drawTriangle=function(a,b,c){tris++;curTris++;return oD(a,b,c);};
const oR=rcp.handleG_TEXRECT.bind(rcp); rcp.handleG_TEXRECT=function(){texr++;return oR.apply(this,arguments);};
const oF=rcp.handleG_FILLRECT.bind(rcp); rcp.handleG_FILLRECT=function(){fillr++;return oF.apply(this,arguments);};
const oP=rcp.processDisplayList.bind(rcp);
rcp.processDisplayList=function(a,d){curTris=0;const r=oP(a,d);if(curTris>0)perTaskTris.push([rcp.f3dex2TaskCount|0,curTris,(this.rspState.colorImage>>>0).toString(16)]);return r;};
const startF=rcp.f3dex2TaskCount|0;const t0=Date.now();const ADV=parseInt(process.env.ADV||'250');
for(let s=0;s<400000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){if((rcp.f3dex2TaskCount|0)-startF>=ADV)break;if(Date.now()-t0>40000)break;}}
log('f3dex2 tasks',(rcp.f3dex2TaskCount|0)-startF,'total tris',tris,'texr',texr,'fillr',fillr);
log('tasks that drew tris:',perTaskTris.length);
for(const e of perTaskTris.slice(0,20))log('  task#'+e[0],'tris='+e[1],'cimg=0x'+e[2]);
