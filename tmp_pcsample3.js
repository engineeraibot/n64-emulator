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
for(let s=0;s<20000000;s++)cpu.step();
const hist=new Map();
for(let s=0;s<6000000;s++){cpu.step();const pc=cpu.pc>>>0;hist.set(pc,(hist.get(pc)||0)+1);}
const sorted=[...hist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20);
console.log('Top PCs over 6M steps (rsp tasks='+(rcp.rspTaskCount|0)+' f3d='+(rcp.f3dTaskCount|0)+'):');
for(const[pc,n]of sorted)console.log('  0x'+pc.toString(16).padStart(8,'0'),n);
