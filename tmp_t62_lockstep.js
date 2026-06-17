// Lockstep RDRAM CRC: build machine A from current rcp.js, machine B from
// rcp_pre_t62_backup.js, co-advance N steps from a state, compare pc + RDRAM CRC.
const fs=require('fs'),path=require('path'),vm=require('vm');
const {loadState}=require('./tmp_state');
const ROOT=__dirname;
function build(rcpFile){
  let c='';
  for(const f of ['memory.js','mmu.js',rcpFile,'cpu.js']) c+=fs.readFileSync(path.join(ROOT,f),'utf8')+'\n';
  c+='\nthis.__c={Memory,MMU,RCP,CPU};\n';
  const sb={console:{log:()=>{},error:()=>{},warn:()=>{}},setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},
    Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
  vm.createContext(sb);vm.runInContext(c,sb,{filename:'e.js'});
  const {Memory,MMU,RCP,CPU}=sb.__c;
  const ROM=path.join(ROOT,process.env.ROM||'Super Mario 64 (Europe) (En,Fr,De).n64');
  const rb=fs.readFileSync(ROM);const ab=rb.buffer.slice(rb.byteOffset,rb.byteOffset+rb.byteLength);
  const fb=new sb.Uint8Array(320*240*4);
  const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,fb);const cpu=new CPU(mmu,rcp);
  mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;if(!cpu.isHleBootDone)cpu.performHleBoot();
  return {ram,mmu,rcp,cpu};
}
function crc(buf){let h=0;const u=new Uint8Array(buf);for(let i=0;i<u.length;i+=64){h=(h*16777619 ^ u[i])>>>0;}return h>>>0;}
const STATE=process.env.STATE||'state_playable';
const N=parseInt(process.env.N||'3000000',10);
const A=build('rcp.js'); loadState(STATE,A.ram,A.mmu,A.cpu,A.rcp);
const B=build('rcp_pre_t62_backup.js'); loadState(STATE,B.ram,B.mmu,B.cpu,B.rcp);
let diverged=-1;
for(let i=0;i<N;i++){
  A.cpu.step(); B.cpu.step();
  if((i&0x3FFFF)===0){ if((A.cpu.pc>>>0)!==(B.cpu.pc>>>0)){diverged=i;break;} }
}
const ca=crc(A.ram.rdram), cb=crc(B.ram.rdram);
console.log(STATE,'N',N,'pc A',(A.cpu.pc>>>0).toString(16),'pc B',(B.cpu.pc>>>0).toString(16),
  'RDRAM crc A',ca.toString(16),'B',cb.toString(16), (ca===cb && diverged<0)?'IDENTICAL':('DIVERGED@'+diverged));
