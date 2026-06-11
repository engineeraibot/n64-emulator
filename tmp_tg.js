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
let hit=0;
for(let s=0;s<9000000;s++){
 const pc=cpu.pc>>>0;
 if(pc===0x802f0d74){
   const sp=cpu.gpr[29]>>>0;
   console.log('@',s,'quot=0x'+(cpu.gpr[2]>>>0).toString(16)+':'+(cpu.gpr[3]>>>0).toString(16),
     'thresh=0x'+rd(sp+112).toString(16)+':'+rd(sp+116).toString(16),
     'glob a120=0x'+rd(0x8030a120).toString(16)+':'+rd(0x8030a124).toString(16),
     'CP0count=0x'+(cpu.cp0Registers[9]>>>0).toString(16));
   if(++hit>=2) break;
 }
 cpu.step();
}
