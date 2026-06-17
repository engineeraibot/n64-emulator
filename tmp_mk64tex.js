process.env.ROM='Mario Kart 64 (Europe) (Rev A).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
loadState(process.env.INSTATE||'state_mk64_menu',ram,mmu,cpu,rcp);
const startF=rcp.f3dTaskCount|0;
let auditOn=false, n=0;
const oTR=rcp.handleG_TEXRECT.bind(rcp);
rcp.handleG_TEXRECT=function(hi,lo,addr,flip,fifo){
  if(auditOn&&n<25){const rs=this.rspState;const ti=(lo>>24)&7;const tile=rs.tiles[ti];
    const wT=tile.lrs>tile.uls?(((tile.lrs-tile.uls)>>2)+1):0;
    const hT=tile.lrt>tile.ult?(((tile.lrt-tile.ult)>>2)+1):0;
    log('TR#'+n,'tile',ti,'fmt',tile.format,'sz',tile.size,'line',tile.line,'tmem',tile.tmem,'pal',tile.palette,
      'size',wT+'x'+hT,'cmS',tile.cmS,'cmT',tile.cmT,'imgW',rs.textureImageWidth,'imgSz',rs.textureImageSize);
    n++;}
  return oTR(hi,lo,addr,flip,fifo);
};
const t0=Date.now();
for(let s=0;s<400000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0xFFF)===0){const f=rcp.f3dTaskCount|0;auditOn=(f-startF)>=1;if((f-startF)>=2){log('done f3d',f);break;}if(Date.now()-t0>34000){log('budget');break;}}}
