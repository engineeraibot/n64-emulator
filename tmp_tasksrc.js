const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=__dirname;
let c='';for(const f of ['memory.js','mmu.js','rcp.js','cpu.js'])c+=fs.readFileSync(path.join(ROOT,f),'utf8')+'\n';
c+='\nthis.__classes={Memory,MMU,RCP,CPU};\n';
const sb={console,setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
vm.createContext(sb);vm.runInContext(c,sb,{filename:'c.js'});
const{Memory,MMU,RCP,CPU}=sb.__classes;
const romBuf=fs.readFileSync(path.join(ROOT,'Super Mario 64 (Europe) (En,Fr,De).n64'));
const ab=romBuf.buffer.slice(romBuf.byteOffset,romBuf.byteOffset+romBuf.byteLength);
const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,new sb.Uint8Array(320*240*4));const cpu=new CPU(mmu,rcp);
mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;cpu.performHleBoot();
// hook runRspTask to log type + caller context
const origRun=rcp.runRspTask.bind(rcp);
const seen={};
rcp.runRspTask=function(){
  const t=this.mmu.spDmemView.getUint32(0xFC0,false)>>>0;
  seen[t]=(seen[t]||0)+1;
  return origRun();
};
// Track set of thread PCs that are "current" right before each VI interrupt service to find game loop
let viCount=0;
for(let s=0;s<90000000;s++){
  cpu.step();
  const mi=mmu.miRegisters[2];
}
console.log('task types seen:',JSON.stringify(seen),'f3d=',rcp.f3dTaskCount|0);
console.log('VI origin=0x'+(mmu.viRegisters[1]&0x7FFFFF).toString(16));
