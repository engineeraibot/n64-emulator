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
const PIEVT=0x80335b60, RETQ=0x80335be8;
function vc(q){return rd.getInt32((q&0x7FFFFF)+8,false);}
let piRaiseCount=0, piEnabledSeen=0, piClearCount=0;
let lastMi10=0, lastPiBusy=0;
let dmaStarts=0;
const origPiDma=mmu.doPiDma.bind(mmu);
mmu.doPiDma=function(c2d){dmaStarts++;return origPiDma(c2d);};
let firstStuckStep=-1;
let snapshots=[];
for(let s=0;s<30000000;s++){
  cpu.step();
  const mi2=mmu.miRegisters[2], mi3=mmu.miRegisters[3];
  const pi=mi2&0x10;
  if(pi&&!lastMi10)piRaiseCount++;
  lastMi10=pi;
  if(mi3&0x10)piEnabledSeen++;
}
console.log('PI DMA starts:',dmaStarts);
console.log('PI interrupt raise events (MI[2]&0x10 0->1):',piRaiseCount);
console.log('steps with PI enabled in MI mask (MI[3]&0x10):',piEnabledSeen);
console.log('PI event queue 0x80335b60 validCount:',vc(PIEVT));
console.log('game retQueue 0x80335be8 validCount:',vc(RETQ));
console.log('final MI[2]=0x'+mmu.miRegisters[2].toString(16),'MI[3]=0x'+mmu.miRegisters[3].toString(16),'piBusyUntil=',mmu.piBusyUntil,'instrCount=',cpu.instructionCount);
