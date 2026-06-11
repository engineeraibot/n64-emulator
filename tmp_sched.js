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
for(let s=0;s<40000000;s++)cpu.step();
console.log('warm PC=0x'+(cpu.pc>>>0).toString(16),'Status=0x'+(cpu.cp0Registers[12]>>>0).toString(16),'Cause=0x'+(cpu.cp0Registers[13]>>>0).toString(16));
const hist=new Map();let viInts=0,lastMi=0,switches=0;
for(let s=0;s<8000000;s++){
  cpu.step();
  if((s&3)===0){const pc=cpu.pc>>>0;hist.set(pc,(hist.get(pc)||0)+1);}
  const mi=mmu.miRegisters[2];if((mi&0x08)&&!(lastMi&0x08))viInts++;lastMi=mi;
}
console.log('After 8M more: PC=0x'+(cpu.pc>>>0).toString(16),'VIints=',viInts,'f3d=',rcp.f3dTaskCount|0,'distinctPCs=',hist.size);
const sorted=[...hist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12);
for(const[pc,n]of sorted)console.log('  0x'+pc.toString(16).padStart(8,'0'),n);
// disasm around the idle spin
console.log('--- code 0x80242e30..0x80242e60 ---');
for(let va=0x80242e30;va<=0x80242e60;va+=4){const w=ram.read32(va&0x7FFFFF)>>>0;console.log('  0x'+va.toString(16),'0x'+w.toString(16).padStart(8,'0'));}
