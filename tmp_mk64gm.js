process.env.ROM='Mario Kart 64 (Europe) (Rev A).n64';
const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
let dumped=0;
const gmHist={};
const origDraw=rcp.drawTriangle.bind(rcp);
rcp.drawTriangle=function(a,b,c){
  const gm=this.rspState.geometryMode>>>0;
  gmHist[gm.toString(16)]=(gmHist[gm.toString(16)]||0)+1;
  if(dumped<3 && (rcp.f3dTaskCount|0)>=80){
    log('gm=0x'+gm.toString(16),'TEXGEN='+((gm&0x40000)?1:0),'TEXGENLIN='+((gm&0x80000)?1:0),'LIGHTING='+((gm&0x20000)?1:0),
        'combine.lo=0x'+(this.rspState.combine.lo>>>0).toString(16),'tile',this.rspState.currentTile,'useTex',this.rspState.useTexture,'texImg=0x'+(this.rspState.textureImage>>>0).toString(16));
    dumped++;
  }
  return origDraw(a,b,c);
};
const t0=Date.now();
for(let s=0;s<200000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){if((rcp.f3dTaskCount|0)>=95){break;}if(Date.now()-t0>35000)break;}}
log('--- geometryMode histogram (top) ---');
Object.entries(gmHist).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(e=>log('gm=0x'+e[0],'count',e[1],'TEXGEN='+((parseInt(e[0],16)&0x40000)?1:0)));
