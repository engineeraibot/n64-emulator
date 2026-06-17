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
const ROM=process.env.ROM||'Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const STATE=process.env.STATE||'state_oot_scene';
const N=parseInt(process.env.N||'12000000',10);
const FILE=process.env.CPUFILE||'cpu.js';
const m=build(FILE,ROM);loadState(STATE,m.ram,m.mmu,m.cpu,m.rcp);
// warmup
for(let i=0;i<2000000;i++)m.cpu.step();
const t0=Date.now();for(let i=0;i<N;i++)m.cpu.step();const dt=(Date.now()-t0)/1000;
console.log(FILE,STATE,'rate',(N/dt/1e6).toFixed(3)+'M/s','('+dt.toFixed(2)+'s)');
