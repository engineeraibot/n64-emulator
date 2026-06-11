const {buildMachine}=require('./tmp_boot');const {loadState,saveState}=require('./tmp_state');
const IN=process.env.IN||'state_title_full', OUT=process.env.OUT;
const m=buildMachine();loadState(IN,m.ram,m.mmu,m.cpu,m.rcp);
const c=m.cpu,rcp=m.rcp,mmu=m.mmu;
let origins=new Set(),lastTri=0,frames=0;
const T0=Date.now();let i=0;
for(;;){
  c.step(); i++;
  // press START every ~40 frames, release for a few
  mmu.updateController((Math.floor(i/250000)%4===0)?0x1000:0,0,0);
  if(rcp.latestVideoTarget){const o=rcp.latestVideoTarget.origin;origins.add((o>>>0).toString(16));}
  if(i%5000000===0){
    console.log('i',(i/1e6).toFixed(0)+'M','f3d',rcp.f3dTaskCount,'btn',mmu.controllerDebug.buttonReads,'origins',[...origins].join(','));
  }
  if(Date.now()-T0>38000)break;
}
console.log('END i',i,'f3d',rcp.f3dTaskCount,'origins',[...origins].join(','));
if(OUT){saveState(OUT,m.ram,m.mmu,m.cpu,m.rcp);console.log('saved',OUT);}
