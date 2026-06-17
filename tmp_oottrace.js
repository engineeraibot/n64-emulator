process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
let tIdx=0, perTask=[];
let tri=0,texr=0,fill=0,cimgSet=0,lastCimg=0;
const oD=rcp.drawTriangle.bind(rcp);rcp.drawTriangle=function(a,b,c){tri++;return oD(a,b,c);};
const oT=rcp.handleG_TEXRECT.bind(rcp);rcp.handleG_TEXRECT=function(...a){texr++;return oT(...a);};
const oF=rcp.handleG_FILLRECT.bind(rcp);rcp.handleG_FILLRECT=function(...a){fill++;return oF(...a);};
const oP=rcp.processDisplayList.bind(rcp);
rcp.processDisplayList=function(addr,ds){
  tri=texr=fill=cimgSet=0;const ci0=this.rspState.colorImage>>>0;
  const r=oP(addr,ds);
  const ci1=this.rspState.colorImage>>>0;
  if(tri||texr||fill||ci1!==ci0)perTask.push({t:tIdx,tri,texr,fill,ci:'0x'+ci1.toString(16)});
  tIdx++;return r;
};
const t0=Date.now();
for(let s=0;s<500000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){if((rcp.f3dex2TaskCount|0)>=600){break;}if(Date.now()-t0>33000)break;}}
log('total gfx tasks',tIdx,'tasks-with-rendering',perTask.length);
log('--- tasks that rendered (first 30) ---');
perTask.slice(0,30).forEach(e=>log('task'+e.t+' tri='+e.tri+' texr='+e.texr+' fill='+e.fill+' cimg='+e.ci));
// histogram of cimg values among rendering tasks
const h={};perTask.forEach(e=>h[e.ci]=(h[e.ci]||0)+1);
log('cimg values:',Object.entries(h).map(e=>e[0]+'('+e[1]+')').join(' '));
