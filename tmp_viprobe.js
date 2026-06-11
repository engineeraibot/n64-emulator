const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_title_full', ram, mmu, cpu, rcp);
const realLog=console.log;
global.console={log:()=>{},warn:()=>{},error:()=>{}};
let lastOrigin=-1, viInts=0, changes=[];
const N=parseInt(process.env.N||'30000000',10);
for(let i=0;i<N;i++){
  const before=mmu.miRegisters[2]&0x08;
  cpu.step();
  // detect VI interrupt edge by origin sampling each 50k
  if((i%20000)===0){
    const o=mmu.viRegisters[1]&0x7FFFFF;
    if(o!==lastOrigin){changes.push([i,o.toString(16)]); lastOrigin=o;}
  }
}
realLog('VI_ORIGIN changes over run:', changes.length);
realLog(changes.slice(0,30).map(c=>c[0]+':0x'+c[1]).join('  '));
realLog('f3d',rcp.f3dTaskCount|0,'viReg width',mmu.viRegisters[2]&0xFFF,'type',mmu.viRegisters[0]&0x3);
