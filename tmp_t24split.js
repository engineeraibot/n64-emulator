const {buildMachine}=require('./tmp_boot');const {loadState}=require('./tmp_state');
const m=buildMachine();loadState('state_t24b',m.ram,m.mmu,m.cpu,m.rcp);
const c=m.cpu,rcp=m.rcp;
let rastMs=0,rastN=0;
const orig=rcp.rasterizeTriangle.bind(rcp);
rcp.rasterizeTriangle=function(...a){const t=process.hrtime.bigint();const r=orig(...a);rastMs+=Number(process.hrtime.bigint()-t)/1e6;rastN++;return r;};
let texMs=0;const ot=rcp.sampleTexture?rcp.sampleTexture.bind(rcp):null;
const T0=Date.now();let i=0;
for(;;){c.step();i++;if(i%500000===0&&Date.now()-T0>30000)break;}
const tot=Date.now()-T0;
console.log('steps',(i/1e6).toFixed(1)+'M','wallMs',tot,'rastMs',rastMs.toFixed(0),'rastCalls',rastN,'rast%',(100*rastMs/tot).toFixed(1));
console.log('stepsPerSec',(i/tot*1000/1e6).toFixed(2)+'M');
