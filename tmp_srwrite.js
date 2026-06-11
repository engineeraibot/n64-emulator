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
const WATCH=0x308af8; // phys of thread 0x803089e0 context.sr (+0x118)
const origW32=mmu.write32.bind(mmu);
let logs=0;
mmu.write32=function(addr,val){
  const phys=(addr&0x7FFFFF)>>>0;
  if(phys===WATCH && logs<30){
    logs++;
    console.log('WRITE ctx.sr <- 0x'+(val>>>0).toString(16),'@PC=0x'+(cpu.pc>>>0).toString(16),'CPUStatus=0x'+(cpu.cp0Registers[12]>>>0).toString(16),'instr',cpu.instructionCount);
  }
  return origW32(addr,val);
};
for(let s=0;s<2000000;s++){try{cpu.step();}catch(e){console.log('threw',e.message);break;} if((cpu.pc>>>0)===0x80242e54)break;}
console.log('done, logs='+logs);
