const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=__dirname;
const files=['memory.js','mmu.js','rcp.js','cpu.js'];
let c='';for(const f of files)c+=fs.readFileSync(path.join(ROOT,f),'utf8')+'\n';
c+='\nthis.__classes={Memory,MMU,RCP,CPU};\n';
const sb={console,setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
vm.createContext(sb);vm.runInContext(c,sb,{filename:'c.js'});
const{Memory,MMU,RCP,CPU}=sb.__classes;
const romBuf=fs.readFileSync(path.join(ROOT,'Super Mario 64 (Europe) (En,Fr,De).n64'));
const ab=romBuf.buffer.slice(romBuf.byteOffset,romBuf.byteOffset+romBuf.byteLength);
const fb=new sb.Uint8Array(320*240*4);
const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,fb);const cpu=new CPU(mmu,rcp);
mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;cpu.performHleBoot();
const N=parseInt(process.argv[2]||'20000000',10);
const hist=new Map();
let viInts=0, siInts=0;
const origCheck=mmu.checkInternalEvents.bind(mmu);
let lastMi=0;
for(let s=0;s<N;s++){
  try{cpu.step();}catch(e){console.log('threw',s,e.message);break;}
  if((s&7)===0){const pc=cpu.pc>>>0;hist.set(pc,(hist.get(pc)||0)+1);}
  const mi=mmu.miRegisters[2];
  if((mi&0x08)&&!(lastMi&0x08))viInts++;
  if((mi&0x02)&&!(lastMi&0x02))siInts++;
  lastMi=mi;
}
console.log('VI ints seen:',viInts,'SI ints seen:',siInts,'f3d:',rcp.f3dTaskCount|0,'rsp:',rcp.rspTaskCount|0);
console.log('PC=0x'+(cpu.pc>>>0).toString(16),'instr',cpu.instructionCount);
const sorted=[...hist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15);
console.log('Top PCs:');
for(const[pc,n]of sorted)console.log('  0x'+pc.toString(16).padStart(8,'0'),n);
// disasm around top pc region
const top=sorted[0][0]>>>0;
console.log('Memory around top PC region (phys):');
for(let i=-4;i<12;i++){const va=(top+i*4)>>>0;const phys=va&0x7FFFFF;const w=ram.read32?ram.read32(phys)>>>0:0;console.log('  0x'+va.toString(16),'0x'+w.toString(16).padStart(8,'0'));}
