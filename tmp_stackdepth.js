// Verify modelview stack stays bounded after push-bit fix (was leaking to 60+)
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState('state_bobpaint', ram, mmu, cpu, rcp);
rcp.f3dTaskCount=0;let max=0;
const orig=rcp.handleG_MTX.bind(rcp);
rcp.handleG_MTX=function(hi,lo){orig(hi,lo);const d=this.rspState.modelviewStack.length;if(d>max)max=d;};
for(let s=0;s<6000000;s++){cpu.step();if((s&0xFFFF)===0&&(rcp.f3dTaskCount|0)>=10)break;}
console.log('frames',rcp.f3dTaskCount|0,'max modelview stack depth',max);
