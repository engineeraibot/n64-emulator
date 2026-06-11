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
const b=new Uint8Array(ram.rdram);
function rd(a){a&=0x7FFFFF;return (b[a]<<24|b[a+1]<<16|b[a+2]<<8|b[a+3])>>>0;}
function str(a){a=a>>>0;a&=0x7FFFFF;let s='';for(let i=0;i<48;i++){const ch=b[a+i];if(ch===0)break;s+=(ch>=32&&ch<127)?String.fromCharCode(ch):'.';}return s;}
const MAX=27000000;
// Maintain a shallow call stack via jal/jr tracking is expensive; instead record ra at dGetWorldPos entry,
// plus the last few distinct function-entry PCs (jal targets) before it.
let ringTarget=[]; // {pc, ra}
let lastWasJal=false, jalTarget=0, jalRA=0;
let prevInstrWord=0;
function read(va){return rd(va);}
let done=false;
for(let s=0;s<MAX;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x80187bac){
    const objp=rd(0x801a7784);
    console.log('dGetWorldPos ENTER step',s,'ra=0x'+(cpu.gpr[31]>>>0).toString(16),'obj=0x'+objp.toString(16),'type=0x'+rd(objp+0xC).toString(16));
    console.log('recent jal targets (oldest->newest):');
    for(const t of ringTarget) console.log('   call 0x'+t.pc.toString(16)+' from ra=0x'+t.ra.toString(16));
    done=true; break;
  }
  // track jal/jalr to build a call ring
  const w=rd(pc);
  const op=w>>>26;
  if(op===0x03){ // jal
    const tgt=((0x80000000)|((w&0x3ffffff)<<2))>>>0;
    ringTarget.push({pc:tgt,ra:(pc+8)>>>0}); if(ringTarget.length>24)ringTarget.shift();
  } else if(op===0 && (w&0x3f)===0x09){ // jalr
    const rs=(w>>21)&31; const tgt=cpu.gpr[rs]>>>0;
    ringTarget.push({pc:tgt,ra:(pc+8)>>>0}); if(ringTarget.length>24)ringTarget.shift();
  }
  cpu.step();
}
if(!done)console.log('dGetWorldPos never entered');
