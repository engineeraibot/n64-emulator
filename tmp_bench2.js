const fs=require('fs'),vm=require('vm');
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
const M=build(process.env.RCP||'rcp.js');
loadState(process.env.STATE||'state_playable',M.ram,M.mmu,M.cpu,M.rcp);
const N=parseInt(process.env.N||'12000000',10);
const t0=Date.now();let i=0;
for(;i<N;i++){try{M.cpu.step();}catch(e){break;}}
const dt=(Date.now()-t0)/1000;
console.log(process.env.RCP||'rcp.js','rate',(i/dt/1e6).toFixed(3)+'M/s f3d',M.rcp.f3dTaskCount|0);
