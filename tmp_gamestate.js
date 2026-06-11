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
const r32=a=>rd.getUint32((a&0x7FFFFF),false)>>>0;
const r16=a=>rd.getUint16((a&0x7FFFFF),false);
function thr(t){return{state:r16(t+0x10),flags:r16(t+0x12),id:r32(t+0x14),pri:r32(t+0x04)|0,queue:r32(t+0x08),pc:r32(t+0x11C),next:r32(t+0x00)};}
function mq(q){return{empty:r32(q+0x00),full:r32(q+0x04),validCount:rd.getInt32(q+0x08,false),first:rd.getInt32(q+0x0C,false),msgCount:rd.getInt32(q+0x10,false),msg:r32(q+0x14)};}
const TOTAL=parseInt(process.env.TOTAL||'30000000',10);
for(let s=0;s<TOTAL;s++)cpu.step();
for(const t of [0x80308d40,0x80308b90,0x80308ef0,0x80333790]){
  const T=thr(t);
  console.log('thread 0x'+t.toString(16),'state='+T.state,'pri='+T.pri,'id='+T.id,'pc=0x'+T.pc.toString(16),'queue=0x'+T.queue.toString(16));
  if(T.queue>0x80000000){const M=mq(T.queue);console.log('   waitQ 0x'+T.queue.toString(16),JSON.stringify(M));}
}
console.log('f3d='+(rcp.f3dTaskCount|0));
