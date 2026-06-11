const {buildMachine}=require('./tmp_boot.js');
const {loadState}=require('./tmp_state.js');
const M=buildMachine();
const st=loadState(process.env.STATE||'state_title_fix',M.ram,M.mmu,M.cpu,M.rcp);
const c=M.cpu,r=M.rcp,mmu=M.mmu;
// CP0 Count = cp0[9], Compare = cp0[11]
console.error('pc=0x'+(c.pc>>>0).toString(16),'count=0x'+(c.cp0Registers[9]>>>0).toString(16),'compare=0x'+(c.cp0Registers[11]>>>0).toString(16),'f3d='+r.f3dTaskCount,'instr='+c.instructionCount);
// Intro deadline constant @ *0x80302080
function rd32(a){return mmu.read32(a)>>>0;}
try{console.error('*0x80302080=0x'+rd32(0x80302080).toString(16));}catch(e){console.error('rd fail',e.message);}
