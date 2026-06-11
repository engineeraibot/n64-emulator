const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=__dirname;
const files=['memory.js','mmu.js','rcp.js','cpu.js'];
let c='';for(const f of files)c+=fs.readFileSync(path.join(ROOT,f),'utf8')+'\n';
c+='\nthis.__classes={Memory,MMU,RCP,CPU};\n';
const sb={console,setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
vm.createContext(sb);vm.runInContext(c,sb,{filename:'c.js'});
const{Memory,MMU,RCP,CPU}=sb.__classes;
const romBuf=fs.readFileSync(path.join(ROOT,'Super Mario 64 (Europe) (En,Fr,De).n64'));
const ab=romBuf.buffer.slice(romBuf.byteOffset,romBuf.byteOffset+romBuf.byteLength);
const fb=new sb.Uint8Array(320*240*4);
const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,fb);const cpu=new CPU(mmu,rcp);
mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;cpu.performHleBoot();
// warm up to steady state
for(let s=0;s<12000000;s++){try{cpu.step();}catch(e){console.log('threw',e.message);break;}}
console.log('warm PC=0x'+(cpu.pc>>>0).toString(16));
// trace 120 instr
let prev=-1;
for(let s=0;s<160;s++){
  const pc=cpu.pc>>>0;
  const phys=pc&0x7FFFFF;
  const instr=(ram.read32?ram.read32(phys)>>>0:0);
  console.log(s.toString().padStart(3),'PC=0x'+pc.toString(16).padStart(8,'0'),'I=0x'+instr.toString(16).padStart(8,'0'),
    'ra=0x'+(cpu.gpr[31]>>>0).toString(16),'sp=0x'+(cpu.gpr[29]>>>0).toString(16),'v0=0x'+(cpu.gpr[2]>>>0).toString(16));
  try{cpu.step();}catch(e){console.log('threw',e.message);break;}
}
