// Task #60: throughput A/B, interpreter vs block-JIT, both from cpu.js.
// Reports REAL (non-idle-fast-forward) instruction rate + total.
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
const ROM=process.env.ROM||'Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const STATE=process.env.STATE||'state_oot_scene';
const N=parseInt(process.env.N||'12000000',10);
const JIT=process.env.JIT==='1';
const m=build(ROM);loadState(STATE,m.ram,m.mmu,m.cpu,m.rcp);m.cpu.useJit=JIT;
const cpu=m.cpu;
let idleSkip=0; const _ff=cpu.tryFastForwardIdleLoop.bind(cpu);
cpu.tryFastForwardIdleLoop=function(s,c){const b=cpu.instructionCount;const r=_ff(s,c);if(r)idleSkip+=(cpu.instructionCount-b);return r;};
function drive(target){ if(JIT){ while(cpu.instructionCount<target) cpu.stepJit(); } else { while(cpu.instructionCount<target) cpu.step(); } }
drive(cpu.instructionCount+1500000);
const start=cpu.instructionCount,idle0=idleSkip;
const t0=Date.now(); drive(start+N); const dt=(Date.now()-t0)/1000;
const adv=cpu.instructionCount-start, skipped=idleSkip-idle0, real=adv-skipped;
console.log((JIT?'JIT  ':'INTERP'),STATE,'real-rate',(real/dt/1e6).toFixed(3)+'M/s','| total',(adv/dt/1e6).toFixed(1)+'M/s','('+dt.toFixed(2)+'s,',(real/1e6).toFixed(2)+'M real,',(skipped/1e6).toFixed(1)+'M idle)',JIT?('blk '+cpu.jitCache.size):'');
