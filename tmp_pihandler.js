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
let lastMi10=0; let traceLeft=0; let captured=0; let trace=[];
let whichDma=0;
for(let s=0;s<30000000;s++){
  const pi=mmu.miRegisters[2]&0x10;
  if(pi&&!lastMi10){ // PI just raised
    whichDma++;
    if(whichDma===5){traceLeft=4000;}
  }
  lastMi10=pi;
  if(traceLeft>0){
    const pc=cpu.pc>>>0;
    // record unique-ish PCs in OS interrupt range
    trace.push(pc);
    traceLeft--;
  }
  cpu.step();
}
// summarize: find the sequence of distinct PCs, looking for branches near MI read
// Just print compressed run
let out=[],prev=-1,cnt=0;
for(const pc of trace){ if(pc===prev){cnt++;} else { if(prev>=0)out.push('0x'+prev.toString(16)+(cnt>1?'(x'+cnt+')':'')); prev=pc;cnt=1;} }
if(prev>=0)out.push('0x'+prev.toString(16)+(cnt>1?'(x'+cnt+')':''));
// only show OS handler region 0x802f0000-0x802f9000 transitions, condensed
console.log(out.slice(0,400).join(' '));
