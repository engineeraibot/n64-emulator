const {buildMachine}=require('./tmp_boot');const {loadState}=require('./tmp_state');
const m=buildMachine();loadState('state_title_full',m.ram,m.mmu,m.cpu,m.rcp);
const c=m.cpu,rcp=m.rcp,mmu=m.mmu;
const rd=new Uint8Array(m.ram.rdram);
// candidate gGlobalTimer search: track a word that increments ~1/frame later
let origins=new Set();
const press=process.env.PRESS==='1';
let lastF3d=0;
const T0=Date.now();
for(let i=0;i<80000000;i++){
  c.step();
  if(press){ mmu.updateController((Math.floor(i/300000)%2)?0x1000:0,0,0); }
  if(i%10000000===0){
    const o=rcp.latestVideoTarget||rcp.colorImageAddr||0;
    origins.add((o>>>0).toString(16));
    console.log('i',i/1e6+'M','f3d',rcp.f3dTaskCount,'btnReads',mmu.controllerDebug.buttonReads,'ch0',mmu.controllerDebug.channel0Cmds,'lastBtn',(mmu.controllerDebug.lastButtons||0).toString(16),'origin',(o>>>0).toString(16));
  }
  if(Date.now()-T0>40000){console.log('time budget hit at',i);break;}
}
console.log('origins',[...origins].join(','));
