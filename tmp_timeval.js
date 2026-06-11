const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=__dirname;
function build(cpuFile){
 let c='';for(const f of ['memory.js','mmu.js','rcp.js',cpuFile])c+=fs.readFileSync(path.join(ROOT,f),'utf8')+'\n';
 c+='\nthis.__classes={Memory,MMU,RCP,CPU};\n';
 const sb={console:{log:()=>{}},setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
 vm.createContext(sb);vm.runInContext(c,sb,{filename:cpuFile});
 const{Memory,MMU,RCP,CPU}=sb.__classes;
 const romBuf=fs.readFileSync(path.join(ROOT,'Super Mario 64 (Europe) (En,Fr,De).n64'));
 const ab=romBuf.buffer.slice(romBuf.byteOffset,romBuf.byteOffset+romBuf.byteLength);
 const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,new sb.Uint8Array(320*240*4));const cpu=new CPU(mmu,rcp);
 mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;cpu.performHleBoot();
 return cpu;
}
const tag=process.env.CPUF;
const cpu=build(tag);
const N=9000000;
let hit=0;
for(let s=0;s<N;s++){
 const pc=cpu.pc>>>0;
 if(pc===0x802f0d54){ // after mul: v0:v1=product
   console.log('['+tag+'] @',s,'product hi=0x'+(cpu.gpr[2]>>>0).toString(16)+' lo=0x'+(cpu.gpr[3]>>>0).toString(16)); }
 if(pc===0x802f0d74){ // after divide: v0:v1 quotient
   console.log('  quotient v0=0x'+(cpu.gpr[2]>>>0).toString(16)+' v1=0x'+(cpu.gpr[3]>>>0).toString(16)); 
   if(++hit>3) break; }
 cpu.step();
}
