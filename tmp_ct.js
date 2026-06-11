const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=__dirname;
let c='';for(const f of ['memory.js','mmu.js','rcp.js','cpu.js'])c+=fs.readFileSync(path.join(ROOT,f),'utf8')+'\n';
c+='\nthis.__classes={Memory,MMU,RCP,CPU};\n';
const sb={console:{log:()=>{}},setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
vm.createContext(sb);vm.runInContext(c,sb,{filename:'c.js'});
const{Memory,MMU,RCP,CPU}=sb.__classes;
const romBuf=fs.readFileSync(path.join(ROOT,'Super Mario 64 (Europe) (En,Fr,De).n64'));
const ab=romBuf.buffer.slice(romBuf.byteOffset,romBuf.byteOffset+romBuf.byteLength);
const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,new sb.Uint8Array(320*240*4));const cpu=new CPU(mmu,rcp);
mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;cpu.performHleBoot();
const b=new Uint8Array(ram.rdram);
function rd(a){a&=0x7FFFFF;return (b[a]<<24|b[a+1]<<16|b[a+2]<<8|b[a+3])>>>0;}
let last=-1,changes=0;
for(let s=0;s<9000000;s++){
 cpu.step();
 const v=rd(0x80302084); // low word of __osCurrentTime
 if(v!==last){ if(changes<25) console.log('@',s,'__osCurrentTime=0x'+rd(0x80302080).toString(16)+':'+v.toString(16),'count=0x'+(cpu.cp0Registers[9]>>>0).toString(16),'pc=0x'+(cpu.pc>>>0).toString(16)); last=v; changes++; }
}
console.log('total changes',changes);
