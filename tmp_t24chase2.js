const {buildMachine}=require('./tmp_boot');const {loadState,saveState}=require('./tmp_state');
const IN=process.env.IN, OUT=process.env.OUT, HOLD=process.env.HOLD==='1';
const m=buildMachine();loadState(IN,m.ram,m.mmu,m.cpu,m.rcp);
const c=m.cpu,rcp=m.rcp,mmu=m.mmu;
if(HOLD)mmu.updateController(0x1000,0,0);
let origins=new Set();const T0=Date.now();let i=0;
for(;;){
  c.step(); i++;
  if(i%200000===0){
    if(rcp.latestVideoTarget)origins.add((rcp.latestVideoTarget.origin>>>0).toString(16));
    if(Date.now()-T0>37000)break;
  }
}
console.log('END i',(i/1e6).toFixed(1)+'M','f3d',rcp.f3dTaskCount,'btnReads',mmu.controllerDebug.buttonReads,'origins',[...origins].join(','));
if(OUT){saveState(OUT,m.ram,m.mmu,m.cpu,m.rcp);console.log('saved',OUT);}
