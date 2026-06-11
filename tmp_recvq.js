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
const GAME=0x80308d40;
const recvByThreadQ={}; // "thread:queue" -> count
let lastGameRecvQ=0, lastGameRecvFlags=0;
for(let s=0;s<90000000;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x802f40b0){curThread=cpu.gpr[26]>>>0;}
  if(pc===0x802ef780){ // osRecvMesg entry: a0=queue a2=flags
    const q=cpu.gpr[4]>>>0, fl=cpu.gpr[6]>>>0;
    const key=(curThread>>>0).toString(16)+':'+q.toString(16);
    recvByThreadQ[key]=(recvByThreadQ[key]||0)+1;
    if(curThread===GAME){lastGameRecvQ=q;lastGameRecvFlags=fl;}
  }
  cpu.step();
}
console.log('osRecvMesg calls by thread:queue ->');
for(const[k,v]of Object.entries(recvByThreadQ))console.log('  '+k,'x'+v);
console.log('GAME last recv queue: 0x'+lastGameRecvQ.toString(16),'flags=',lastGameRecvFlags);
// dump queue struct: msgCount(off? layout: next,prev? actually OSMesgQueue: mtqueue(0),fullqueue(4),validCount(8),first(12),msgCount(16),msg(20))
function dq(q){const p=q&0x7FFFFF;return {validCount:rd.getInt32(p+8,false),first:rd.getInt32(p+12,false),msgCount:rd.getInt32(p+16,false),msgPtr:rd.getUint32(p+20,false)>>>0};}
if(lastGameRecvQ)console.log('GAME queue struct:',JSON.stringify(dq(lastGameRecvQ)));
