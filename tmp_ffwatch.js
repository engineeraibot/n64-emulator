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
const off=cpu.tryFastForwardIdleLoop.bind(cpu);
let mtcSeen=false, compareVal=0, overshoots=0;
let firstCross=null;
cpu.tryFastForwardIdleLoop=function(st,ca){
  const before=this.cp0Registers[9]>>>0;
  const r=off(st,ca);
  const after=this.cp0Registers[9]>>>0;
  const cmp=this.cp0Registers[11]>>>0;
  if(r&&cmp!==0){
    // did we cross compare without landing?
    if(before<cmp && after>cmp){ overshoots++; if(!firstCross)firstCross={before,after,cmp,ic:this.instructionCount}; }
  }
  return r;
};
for(let s=0;s<20000000;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x802f7070){compareVal=cpu.gpr[4]>>>0; console.log('mtc0 Compare set: a0=0x'+compareVal.toString(16)+' Count=0x'+(cpu.cp0Registers[9]>>>0).toString(16)+' instrCount='+cpu.instructionCount);}
  cpu.step();
}
console.log('fast-forward overshoots past Compare:',overshoots);
if(firstCross)console.log('first overshoot:',JSON.stringify(firstCross,(k,v)=>typeof v==='number'?'0x'+v.toString(16):v));
