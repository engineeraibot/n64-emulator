const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
function crc32(buf){let c=0xFFFFFFFF;for(let i=0;i<buf.length;i++){c^=buf[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}return (c^0xFFFFFFFF)>>>0;}
const st=process.env.STATE, N=parseInt(process.env.N||'3000000',10);
if(process.env.ROM) {} // set by caller
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(st,ram,mmu,cpu,rcp);
for(let i=0;i<N;i++){try{cpu.step();}catch(e){console.log('threw',i,e.message);break;}}
const b=new Uint8Array(ram.rdram);
console.log(st,'N',N,'rdramCRC',crc32(b).toString(16).padStart(8,'0'),'pc',(cpu.pc>>>0).toString(16),'ic',cpu.instructionCount);
