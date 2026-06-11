const fs=require('fs'),path=require('path'),vm=require('vm');
const {loadState}=require('./tmp_state');
function build(cpuFile){
  const ROOT=__dirname;
  let c='';for(const f of ['memory.js','mmu.js','rcp.js',cpuFile])c+=fs.readFileSync(path.join(ROOT,f),'utf8')+'\n';
  c+='\nthis.__c={Memory,MMU,RCP,CPU};\n';
  const sb={console:{log:()=>{},error:()=>{},warn:()=>{}},setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},
    Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
  vm.createContext(sb);vm.runInContext(c,sb,{filename:cpuFile});
  const {Memory,MMU,RCP,CPU}=sb.__c;
  const ROM=path.join(ROOT,'Super Mario 64 (Europe) (En,Fr,De).n64');
  const rb=fs.readFileSync(ROM);const ab=rb.buffer.slice(rb.byteOffset,rb.byteOffset+rb.byteLength);
  const fb=new sb.Uint8Array(320*240*4);
  const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,fb);const cpu=new CPU(mmu,rcp);
  mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;if(!cpu.isHleBootDone)cpu.performHleBoot();
  return {ram,mmu,rcp,cpu};
}
function sig(m){
  let h=0x811c9dc5>>>0;
  const add=(x)=>{h=(Math.imul(h^(x>>>0),0x01000193))>>>0;};
  const c=m.cpu;
  for(let i=0;i<32;i++){add(c.gpr[i]);add(c.gprHi[i]);}
  for(let i=0;i<32;i++)add(c.cp0Registers[i]);
  add(c.pc);add(c.hi);add(c.lo);add(c.hiH);add(c.loH);add(c.fcr31);add(c.instructionCount>>>0);
  // rdram crc (sample)
  const u=new Uint8Array(m.ram.rdram);for(let i=0;i<u.length;i+=997)add(u[i]);
  return h>>>0;
}
const STATE=process.env.STATE||'state_advfix1';
const N=parseInt(process.env.N||'6000000',10);
const A=build('cpu_pre_fastdispatch_backup.js');loadState(STATE,A.ram,A.mmu,A.cpu,A.rcp);
const B=build('cpu.js');loadState(STATE,B.ram,B.mmu,B.cpu,B.rcp);
const CHUNK=200000;let ok=true;
for(let done=0;done<N&&ok;done+=CHUNK){
  for(let i=0;i<CHUNK;i++){A.cpu.step();}
  for(let i=0;i<CHUNK;i++){B.cpu.step();}
  const sa=sig(A),sb2=sig(B);
  if(sa!==sb2){console.log('DIVERGE at',done+CHUNK,'A',sa.toString(16),'B',sb2.toString(16),'pcA',A.cpu.pc.toString(16),'pcB',B.cpu.pc.toString(16));ok=false;}
}
if(ok)console.log('IDENTICAL over',N,'steps  sig',sig(A).toString(16),'pc',A.cpu.pc.toString(16),'f3d',A.rcp.f3dTaskCount|0);
