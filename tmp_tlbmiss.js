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
// wrap translateAddress to log mapped-region accesses that fall outside the single window
const orig=mmu.translateAddress.bind(mmu);
const missRanges={};
mmu.translateAddress=function(va){
  const v=va>>>0;
  if(v>=0x04000000 && v<0x10000000){
    const p=orig(va)>>>0;
    if(p===v){ // identity fallback = MISS
      const key='0x'+(v&0xFFFE0000).toString(16);
      missRanges[key]=(missRanges[key]||0)+1;
    }
    return p;
  }
  return orig(va);
};
const MAX=26155000;
for(let s=0;s<MAX;s++)cpu.step();
console.log('TLB-mapped-region MISS (identity fallback) histogram by 128K window:');
for(const k of Object.keys(missRanges).sort())console.log('  '+k+' : '+missRanges[k]);
