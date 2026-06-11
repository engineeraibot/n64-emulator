const {buildMachine}=require('./tmp_boot');const {loadState}=require('./tmp_state');
const m=buildMachine();const meta=loadState(process.env.STATE||'state_title_full',m.ram,m.mmu,m.cpu,m.rcp);
const c=m.cpu;
console.log('pc',c.pc.toString(16),'count',(c.cp0Registers[9]>>>0).toString(16),'compare',(c.cp0Registers[11]>>>0).toString(16));
console.log('f3d',m.rcp.f3dTaskCount,'instr',c.instructionCount);
