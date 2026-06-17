process.env.ROM='Mario Kart 64 (Europe) (Rev A).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState(process.env.INSTATE||'state_mk64_menu',ram,mmu,cpu,rcp);
const startF=rcp.f3dTaskCount|0;
let auditOn=false, n=0;
const oLB=rcp.handleG_LOADBLOCK.bind(rcp);
rcp.handleG_LOADBLOCK=function(hi,lo){
  if(auditOn&&n<8){const rs=this.rspState;const t=(lo>>24)&7;
    const uls=(hi>>>12)&0xFFF,ult=hi&0xFFF,lrs=(lo>>>12)&0xFFF,dxt=lo&0xFFF;
    log('LB#'+n,'tile',t,'uls',uls,'ult',ult,'lrs',lrs,'dxt',dxt,'imgW',rs.textureImageWidth,'imgSz',rs.textureImageSize,'imgAddr0x'+(rs.textureImage>>>0).toString(16),'tmem',rs.tiles[t].tmem);n++;}
  return oLB(hi,lo);
};
const oST=rcp.handleG_SETTILE.bind(rcp);
let m=0;
rcp.handleG_SETTILE=function(hi,lo){const r=oST(hi,lo);if(auditOn&&m<8){const t=(lo>>24)&7;const tl=this.rspState.tiles[t];log('  SETTILE tile',t,'fmt',tl.format,'sz',tl.size,'line',tl.line,'tmem',tl.tmem);m++;}return r;};
const t0=Date.now();
for(let s=0;s<400000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0xFFF)===0){const f=rcp.f3dTaskCount|0;auditOn=(f-startF)>=1;if((f-startF)>=2){log('done');break;}if(Date.now()-t0>34000){log('budget');break;}}}
