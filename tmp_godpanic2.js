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
function str(a){a=a>>>0;a&=0x7FFFFF;let s='';for(let i=0;i<80;i++){const ch=b[a+i];if(ch===0)break;s+=(ch>=32&&ch<127)?String.fromCharCode(ch):'.';}return s;}
const MAX=parseInt(process.argv[2]||'27000000');
// capture every jal that targets the goddard error-format function range, and the printf calls inside
let inErr=false; let captured=0;
let lastFmt=null; let lastArgs=null;
for(let s=0;s<MAX;s++){
  const pc=cpu.pc>>>0;
  // detect a jal-style entry into the panic formatter region (entry 0x8019aa.. prologue). Capture ra+args at first instr.
  if(pc>=0x8019a900 && pc<0x8019ab40 && !inErr){
    inErr=true;
    console.log('ENTER err-region pc=0x'+pc.toString(16),'step',s,'ra=0x'+(cpu.gpr[31]>>>0).toString(16));
    console.log('  a0=0x'+(cpu.gpr[4]>>>0).toString(16)+' ["'+str(cpu.gpr[4])+'"]');
    console.log('  a1=0x'+(cpu.gpr[5]>>>0).toString(16)+' ["'+str(cpu.gpr[5])+'"]');
    console.log('  a2=0x'+(cpu.gpr[6]>>>0).toString(16)+' a3=0x'+(cpu.gpr[7]>>>0).toString(16));
  }
  if(pc<0x8019a900 || pc>=0x8019ab40) inErr=false;
  if(pc===0x8019ab3c){
    console.log('=== exit() step',s,'===');
    break;
  }
  cpu.step();
}
