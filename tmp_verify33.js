const fs=require('fs'),path=require('path'),vm=require('vm');
const {loadState}=require('./tmp_state');
function build(rcpFile){
  let c='';for(const f of ['memory.js','mmu.js',rcpFile,'cpu.js'])c+=fs.readFileSync(f,'utf8')+'\n';
  c+='\nthis.__c={Memory,MMU,RCP,CPU};';
  const sb={console:{log:()=>{},error:()=>{},warn:()=>{}},setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
  vm.createContext(sb);vm.runInContext(c,sb,{});const {Memory,MMU,RCP,CPU}=sb.__c;
  const rb=fs.readFileSync('Super Mario 64 (Europe) (En,Fr,De).n64');const ab=rb.buffer.slice(rb.byteOffset,rb.byteOffset+rb.byteLength);
  const fb=new sb.Uint8Array(320*240*4);
  const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,fb);const cpu=new CPU(mmu,rcp);
  mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;cpu.performHleBoot();return{ram,mmu,rcp,cpu,fb};
}
function crc(buf){let h=0x811c9dc5>>>0;const u=buf instanceof Uint8Array?buf:new Uint8Array(buf);for(let i=0;i<u.length;i+=1)h=(Math.imul(h^u[i],0x01000193))>>>0;return h>>>0;}
const STATE=process.env.STATE||'state_advfix1';const N=parseInt(process.env.N||'8000000',10);
const A=build('rcp_pre_task33_backup.js');loadState(STATE,A.ram,A.mmu,A.cpu,A.rcp);
const B=build('rcp.js');loadState(STATE,B.ram,B.mmu,B.cpu,B.rcp);
for(let i=0;i<N;i++){A.cpu.step();B.cpu.step();}
const ca=crc(A.ram.rdram),cb=crc(B.ram.rdram);
console.log('rdram crc  A',ca.toString(16),'B',cb.toString(16), ca===cb?'IDENTICAL':'DIFFER');
