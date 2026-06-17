process.env.ROM='Mario Kart 64 (Europe) (Rev A).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState(process.env.INSTATE||'state_mk64_menu',ram,mmu,cpu,rcp);
const startF=rcp.f3dTaskCount|0;
let lb=0,lt=0,ti=0,settimg=0;
const oLB=rcp.handleG_LOADBLOCK.bind(rcp);
rcp.handleG_LOADBLOCK=function(hi,lo){if(lb<6){const t=(lo>>24)&7;log('LOADBLOCK#'+lb,'tile',t,'lrs',(lo>>>12)&0xFFF,'dxt',lo&0xFFF,'imgW',this.rspState.textureImageWidth,'imgAddr0x'+(this.rspState.textureImage>>>0).toString(16));lb++;}return oLB(hi,lo);};
const oLT=rcp.handleG_LOADTILE.bind(rcp);
rcp.handleG_LOADTILE=function(hi,lo){if(lt<6){const t=(lo>>24)&7;log('LOADTILE#'+lt,'tile',t,'uls',(hi>>>12)&0xFFF,'ult',hi&0xFFF,'lrs',(lo>>>12)&0xFFF,'lrt',lo&0xFFF,'imgW',this.rspState.textureImageWidth,'imgAddr0x'+(this.rspState.textureImage>>>0).toString(16));lt++;}return oLT(hi,lo);};
// SETTIMG hook
const oDL=rcp.processDisplayList?rcp.processDisplayList.bind(rcp):null;
const t0=Date.now();
for(let s=0;s<400000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0xFFF)===0){const f=rcp.f3dTaskCount|0;if((f-startF)>=2){log('done loadblocks',lb,'loadtiles',lt);break;}if(Date.now()-t0>34000){log('budget lb',lb,'lt',lt);break;}}}
