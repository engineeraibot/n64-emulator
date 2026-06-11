const fs=require('fs'),path=require('path'),vm=require('vm');
const {loadState}=require('./tmp_state');
function build(rcpFile){
  const ROOT=__dirname;let c='';
  for(const f of ['memory.js','mmu.js',rcpFile,'cpu.js'])c+=fs.readFileSync(path.join(ROOT,f),'utf8')+'\n';
  c+='\nthis.__c={Memory,MMU,RCP,CPU};\n';
  const sb={console:{log:()=>{},error:()=>{},warn:()=>{}},setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},
    Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
  vm.createContext(sb);vm.runInContext(c,sb,{filename:'e.js'});
  const {Memory,MMU,RCP,CPU}=sb.__c;
  const ROM=path.join(ROOT,'Super Mario 64 (Europe) (En,Fr,De).n64');
  const rb=fs.readFileSync(ROM);const ab=rb.buffer.slice(rb.byteOffset,rb.byteOffset+rb.byteLength);
  const fb=new sb.Uint8Array(320*240*4);
  const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,fb);const cpu=new CPU(mmu,rcp);
  mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;if(!cpu.isHleBootDone)cpu.performHleBoot();
  return {ram,mmu,rcp,cpu};
}
function bench(rcpFile,label,ms){
  const m=build(rcpFile);loadState('state_t24b',m.ram,m.mmu,m.cpu,m.rcp);
  const c=m.cpu;const f0=m.rcp.f3dTaskCount;const T0=Date.now();let i=0;
  for(;;){c.step();i++;if(i%200000===0&&Date.now()-T0>ms)break;}
  const dt=Date.now()-T0;
  console.log(label,'steps/s',(i/dt*1000/1e6).toFixed(3)+'M','frames',m.rcp.f3dTaskCount-f0,'in',dt+'ms');
}
const MS=15000;
bench(process.argv[2]||'rcp.js','A',MS);
bench(process.argv[2]||'rcp.js','A2',MS);
