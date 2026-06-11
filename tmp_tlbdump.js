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
const MAX=26147000;
for(let s=0;s<MAX;s++)cpu.step();
console.log('TLB entries at step',MAX,':');
if(cpu.tlbEntries){for(let i=0;i<cpu.tlbEntries.length;i++){const e=cpu.tlbEntries[i];if(e&&(e.entryHi||e.entryLo0||e.entryLo1))console.log('  ['+i+'] hi=0x'+(e.entryHi>>>0).toString(16)+' lo0=0x'+(e.entryLo0>>>0).toString(16)+' lo1=0x'+(e.entryLo1>>>0).toString(16)+' mask=0x'+(e.pageMask>>>0).toString(16));}}
function tr(va){try{return '0x'+(mmu.translateAddress(va>>>0)>>>0).toString(16);}catch(e){return 'ERR '+e.message;}}
for(const va of [0x80098048,0x8009a3d8,0x8009a3f4,0x04000000,0x04098048,0x0409a3f4,0x05000000]){
  console.log('  translate 0x'+(va>>>0).toString(16),'->',tr(va));
}
