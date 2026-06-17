// Task #60: lockstep byte-identical check, interpreter (A) vs block-JIT (B),
// both built from the SAME cpu.js. Co-advances by instructionCount (block-JIT
// runs whole blocks, so it advances in jumps); compares pc at every alignment
// point and final RDRAM CRC + pc + instrCount.
const fs=require('fs'),vm=require('vm');
function build(romFile){
  let c='';for(const f of ['memory.js','mmu.js','rcp.js','cpu.js'])c+=fs.readFileSync(f,'utf8')+'\n';
  c+='\nthis.__c={Memory,MMU,RCP,CPU};';
  const sb={console:{log:()=>{},error:()=>{},warn:()=>{}},setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array,Map,Function};
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
const N=parseInt(process.env.N||'6000000',10);
const A=build(ROM);loadState(STATE,A.ram,A.mmu,A.cpu,A.rcp);A.cpu.useJit=false;
const B=build(ROM);loadState(STATE,B.ram,B.mmu,B.cpu,B.rcp);B.cpu.useJit=true;
let diverged=-1,checks=0;
const TARGET=A.cpu.instructionCount+N;
while(A.cpu.instructionCount<TARGET && B.cpu.instructionCount<TARGET){
  if(A.cpu.instructionCount<=B.cpu.instructionCount) A.cpu.step(); else B.cpu.stepJit();
  if(A.cpu.instructionCount===B.cpu.instructionCount){checks++;if(A.cpu.pc!==B.cpu.pc){diverged=A.cpu.instructionCount;break;}}
}
// align exactly
let guard=0;
while(A.cpu.instructionCount!==B.cpu.instructionCount && guard++<10000){
  if(A.cpu.instructionCount<B.cpu.instructionCount)A.cpu.step();else B.cpu.stepJit();
}
const ca=crc(A.ram.rdram),cb=crc(B.ram.rdram);
console.log('STATE',STATE,'N',N,'alignChecks',checks);
console.log('rdram crc  interp',ca.toString(16),'jit',cb.toString(16), ca===cb?'IDENTICAL':'DIFFER');
console.log('final pc   interp',(A.cpu.pc>>>0).toString(16),'jit',(B.cpu.pc>>>0).toString(16), A.cpu.pc===B.cpu.pc?'same':'DIFF');
console.log('instrCount interp',A.cpu.instructionCount,'jit',B.cpu.instructionCount, A.cpu.instructionCount===B.cpu.instructionCount?'same':'DIFF');
console.log('jit blocks cached', B.cpu.jitCache.size);
if(diverged>=0)console.log('PC DIVERGED at instrCount',diverged);
else console.log('NO DIVERGENCE across',checks,'alignment points');
