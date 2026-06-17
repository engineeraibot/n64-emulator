const fs=require('fs'),path=require('path'),vm=require('vm');
function buildMachine(romFile){
  const ROOT=__dirname;
  const ROM=path.join(ROOT,romFile||process.env.ROM||'Super Mario 64 (Europe) (En,Fr,De).n64');
  let c='';for(const f of ['memory.js','mmu.js','rcp.js','cpu.js'])c+=fs.readFileSync(path.join(ROOT,f),'utf8')+'\n';
  c+='\nthis.__c={Memory,MMU,RCP,CPU};\n';
  const sb={console:(process.env.VERBOSE?{log:console.error.bind(console),error:console.error.bind(console),warn:console.error.bind(console)}:{log:()=>{},error:()=>{},warn:()=>{}}),setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},
    Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
  vm.createContext(sb);vm.runInContext(c,sb,{filename:'e.js'});
  const {Memory,MMU,RCP,CPU}=sb.__c;
  const rb=fs.readFileSync(ROM);const ab=rb.buffer.slice(rb.byteOffset,rb.byteOffset+rb.byteLength);
  const fb=new sb.Uint8Array(320*240*4);
  const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,fb);const cpu=new CPU(mmu,rcp);
  mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;if(!cpu.isHleBootDone)cpu.performHleBoot();
  return {ram,mmu,rcp,cpu,sb};
}
module.exports={buildMachine};
