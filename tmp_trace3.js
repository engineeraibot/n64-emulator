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
for(let s=0;s<40000000;s++){try{cpu.step();}catch(e){console.log('threw',e.message);break;}}
console.log('warm PC=0x'+(cpu.pc>>>0).toString(16));
for(let s=0;s<80;s++){
  const pc=cpu.pc>>>0,phys=pc&0x7FFFFF,instr=ram.read32(phys)>>>0;
  console.log(s.toString().padStart(3),'PC=0x'+pc.toString(16),'I=0x'+instr.toString(16).padStart(8,'0'),
    't9=0x'+(cpu.gpr[25]>>>0).toString(16),'v0=0x'+(cpu.gpr[2]>>>0).toString(16),'a0=0x'+(cpu.gpr[4]>>>0).toString(16),'s0=0x'+(cpu.gpr[16]>>>0).toString(16));
  try{cpu.step();}catch(e){console.log('threw',e.message);break;}
}
