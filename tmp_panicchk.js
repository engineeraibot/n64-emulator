const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=__dirname;
let c='';for(const f of ['memory.js','mmu.js','rcp.js','cpu.js'])c+=fs.readFileSync(path.join(ROOT,f),'utf8')+'\n';
c+='\nthis.__classes={Memory,MMU,RCP,CPU};\n';
const realLog=console.log;
const sb={console:{log:()=>{}},setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
vm.createContext(sb);vm.runInContext(c,sb,{filename:'c.js'});
const{Memory,MMU,RCP,CPU}=sb.__classes;
const romBuf=fs.readFileSync(path.join(ROOT,'Super Mario 64 (Europe) (En,Fr,De).n64'));
const ab=romBuf.buffer.slice(romBuf.byteOffset,romBuf.byteOffset+romBuf.byteLength);
const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,new sb.Uint8Array(320*240*4));const cpu=new CPU(mmu,rcp);
mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;cpu.performHleBoot();
const b=new Uint8Array(ram.rdram);
const MAX= parseInt(process.env.MAX||'27000000');
let panic=false;
for(let s=0;s<MAX;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x8018c2c8){let f='';let a=cpu.gpr[4]>>>0&0x7FFFFF;for(let i=0;i<60;i++){const ch=b[a+i];if(!ch)break;f+=String.fromCharCode(ch);}
    realLog('PANIC @step',s,JSON.stringify(f)); panic=true; break; }
  if(pc===0x8019ab3c){ realLog('goddard exit() @step',s); panic=true; break; }
  cpu.step();
}
if(!panic) realLog('NO PANIC through',MAX,'steps. f3dTaskCount=',rcp.f3dTaskCount);
