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
const rd=new DataView(ram.rdram);
let timerRaises=0,lastTimer=0;
let setCompareCount=0;
let blockedStep=-1;
let compareAtBlock=0,countAtBlock=0;
for(let s=0;s<30000000;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x802f7070)setCompareCount++; // mtc0 compare
  cpu.step();
  const t=cpu.cp0Registers[13]&0x8000;
  if(t&&!lastTimer)timerRaises++;
  lastTimer=t;
}
console.log('mtc0 Compare (__osSetCompare) calls:',setCompareCount);
console.log('timer interrupt raises (CAUSE 0x8000 0->1):',timerRaises);
console.log('final Count=0x'+(cpu.cp0Registers[9]>>>0).toString(16),'Compare=0x'+(cpu.cp0Registers[11]>>>0).toString(16));
console.log('f3d=',rcp.f3dTaskCount|0);
