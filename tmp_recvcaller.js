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
let curThread=0;
const GAME=0x80308d40, Q=0x80335be8;
const callers={};
// also watch writes to Q validCount via send: hook osSendMesg-like by watching memory write. We'll instead count any sends by scanning each step for change.
let lastValid=rd.getInt32((Q&0x7FFFFF)+8,false);
let sendEvents=[];
let lastSrc='';
for(let s=0;s<20000000;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x802f40b0){curThread=cpu.gpr[26]>>>0;}
  if(pc===0x802ef780 && (cpu.gpr[4]>>>0)===Q){
    const ra=cpu.gpr[31]>>>0;
    callers[ra.toString(16)]=(callers[ra.toString(16)]||0)+1;
  }
  cpu.step();
  const v=rd.getInt32((Q&0x7FFFFF)+8,false);
  if(v!==lastValid){sendEvents.push({s,from:lastValid,to:v,pc:(cpu.pc>>>0).toString(16),thread:curThread.toString(16)});lastValid=v;}
}
console.log('callers of osRecvMesg(Q=0x80335be8) [ra]:',JSON.stringify(callers));
console.log('validCount change events for Q:');
for(const e of sendEvents.slice(0,30))console.log('  step',e.s,e.from,'->',e.to,'pc=0x'+e.pc,'thr=0x'+e.thread);
console.log('total validCount changes:',sendEvents.length);
