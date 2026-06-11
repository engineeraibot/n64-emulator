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
const TOTAL=parseInt(process.env.TOTAL||'30000000',10);
for(let s=0;s<TOTAL;s++)cpu.step();
const b=new Uint8Array(ram.rdram);
function str(a){a&=0x7FFFFF;let s='';for(let i=0;i<200;i++){const ch=b[a+i];if(ch===0)break;s+=(ch>=32&&ch<127)?String.fromCharCode(ch):'\\x'+ch.toString(16);}return s;}
for(const a of (process.env.ADDRS||'0x801b8278').split(',')){console.log('0x'+(parseInt(a,16)>>>0).toString(16),'=>',JSON.stringify(str(parseInt(a,16))));}
