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
const b=new Uint8Array(ram.rdram);
function str(a){a=a>>>0;a&=0x7FFFFF;let s='';for(let i=0;i<90;i++){const ch=b[a+i];if(ch===0)break;s+=(ch>=32&&ch<127)?String.fromCharCode(ch):'.';}return s;}
const MAX=27000000;
let lastRA=0;
for(let s=0;s<MAX;s++){
  const pc=cpu.pc>>>0;
  if(s>26140000){
    if(pc===0x8018c258||pc===0x8018c2c8){
      console.log('s'+s,'printf fmt="'+str(cpu.gpr[4])+'" a1=0x'+(cpu.gpr[5]>>>0).toString(16)+'("'+str(cpu.gpr[5])+'") a2=0x'+(cpu.gpr[6]>>>0).toString(16)+'("'+str(cpu.gpr[6])+'") ra=0x'+(cpu.gpr[31]>>>0).toString(16));
    }
  }
  // detect call into the gd_exit function (the one ending at 0x8019ab3c). Its entry prologue:
  if(pc===0x8019ab3c){ console.log('=== reached 0x8019ab3c (exit print) step',s,'ra=0x'+(cpu.gpr[31]>>>0).toString(16),'===');
    break; }
  cpu.step();
}
