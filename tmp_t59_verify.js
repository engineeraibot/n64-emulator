// Lockstep byte-identical + timing A/B for a CPU change.
// CPUFILE_A / CPUFILE_B select cpu source; ROM selects ROM; STATE the checkpoint.
const fs=require('fs'),vm=require('vm');
function build(cpuFile, romFile){
  let c='';for(const f of ['memory.js','mmu.js','rcp.js',cpuFile])c+=fs.readFileSync(f,'utf8')+'\n';
  c+='\nthis.__c={Memory,MMU,RCP,CPU};';
  const sb={console:{log:()=>{},error:()=>{},warn:()=>{}},setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
  vm.createContext(sb);vm.runInContext(c,sb,{});const {Memory,MMU,RCP,CPU}=sb.__c;
  const rb=fs.readFileSync(romFile);const ab=rb.buffer.slice(rb.byteOffset,rb.byteOffset+rb.byteLength);
  const fb=new sb.Uint8Array(320*240*4);
  const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,fb);const cpu=new CPU(mmu,rcp);
  mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;cpu.performHleBoot();return{ram,mmu,rcp,cpu,fb};
}
const {loadState}=require('./tmp_state');
function crc(buf){let h=0x811c9dc5>>>0;const u=buf instanceof Uint8Array?buf:new Uint8Array(buf);for(let i=0;i<u.length;i++)h=(Math.imul(h^u[i],0x01000193))>>>0;return h>>>0;}
const ROM=process.env.ROM||'Super Mario 64 (Europe) (En,Fr,De).n64';
const STATE=process.env.STATE||'state_advfix1';
const N=parseInt(process.env.N||'8000000',10);
const A=build(process.env.CPUFILE_A||'cpu_pre_t59_backup.js', ROM);loadState(STATE,A.ram,A.mmu,A.cpu,A.rcp);
const B=build(process.env.CPUFILE_B||'cpu.js', ROM);loadState(STATE,B.ram,B.mmu,B.cpu,B.rcp);
// lockstep correctness
let diverged=-1;
for(let i=0;i<N;i++){A.cpu.step();B.cpu.step();
  if((i&0xFFFFF)===0){ if(A.cpu.pc!==B.cpu.pc){diverged=i;break;} }
}
const ca=crc(A.ram.rdram),cb=crc(B.ram.rdram);
console.log('STATE',STATE,'N',N);
console.log('rdram crc  A',ca.toString(16),'B',cb.toString(16), ca===cb?'IDENTICAL':'DIFFER');
console.log('final pc   A',(A.cpu.pc>>>0).toString(16),'B',(B.cpu.pc>>>0).toString(16), A.cpu.pc===B.cpu.pc?'same':'DIFF');
console.log('instrCount A',A.cpu.instructionCount,'B',B.cpu.instructionCount, A.cpu.instructionCount===B.cpu.instructionCount?'same':'DIFF');
if(diverged>=0)console.log('PC DIVERGED at step',diverged);
