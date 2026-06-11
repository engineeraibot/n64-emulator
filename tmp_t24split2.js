const {buildMachine}=require('./tmp_boot');const {loadState}=require('./tmp_state');
const m=buildMachine();loadState('state_t24b',m.ram,m.mmu,m.cpu,m.rcp);
const c=m.cpu,rcp=m.rcp;
let stMs=0,stN=0,cmMs=0,cmN=0,blMs=0,blN=0;
const ost=rcp.sampleTexture.bind(rcp);rcp.sampleTexture=function(...a){const t=process.hrtime.bigint();const r=ost(...a);stMs+=Number(process.hrtime.bigint()-t)/1e6;stN++;return r;};
const ocm=rcp.combineColor.bind(rcp);rcp.combineColor=function(...a){const t=process.hrtime.bigint();const r=ocm(...a);cmMs+=Number(process.hrtime.bigint()-t)/1e6;cmN++;return r;};
const obl=rcp.blendPixel.bind(rcp);rcp.blendPixel=function(...a){const t=process.hrtime.bigint();const r=obl(...a);blMs+=Number(process.hrtime.bigint()-t)/1e6;blN++;return r;};
const T0=Date.now();let i=0;for(;;){c.step();i++;if(i%500000===0&&Date.now()-T0>25000)break;}
const tot=Date.now()-T0;
console.log('wallMs',tot,'steps',(i/1e6).toFixed(1)+'M');
console.log('sampleTexture ms',stMs.toFixed(0),'calls',stN,'=>',(100*stMs/tot).toFixed(1)+'%','us/call',(stMs*1000/stN).toFixed(2));
console.log('combineColor ms',cmMs.toFixed(0),'calls',cmN,'=>',(100*cmMs/tot).toFixed(1)+'%','us/call',(cmMs*1000/cmN).toFixed(2));
console.log('blendPixel ms',blMs.toFixed(0),'calls',blN,'=>',(100*blMs/tot).toFixed(1)+'%','us/call',(blMs*1000/blN).toFixed(2));
