const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState('state_hold1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
const b=new Uint8Array(ram.rdram);
function str(a){a&=0x7FFFFF;let s='';for(let i=0;i<48;i++){const c=b[a+i];if(c===0)break;s+=(c>=32&&c<127)?String.fromCharCode(c):'.';}return s;}
for(const a of [0x801b84b4,0x801b84c0,0x801b84ec,0x801b84f0,0x801b8524,0x801b8528,0x801b8550,0x801a6c90,0x801a6c80]) realLog('0x'+a.toString(16),'=',JSON.stringify(str(a)));
