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
// instrument opCOP0 by watching for mtc0 to rd=11. Hook via wrapping cp0 write: easier to detect in step via decode.
let writes=[];
const origStep=cpu.step.bind(cpu);
let n=0;
cpu.step=function(){
  const pc=this.pc>>>0; const w=this.mmu.read32(pc)>>>0;
  // COP0 MTC0: op=0x10, sub(bits21-25)=0x04, rd(bits11-15)=11
  if((w>>>26)===0x10 && ((w>>21)&0x1F)===0x04 && ((w>>11)&0x1F)===11){
    const rt=(w>>16)&0x1F; const val=this.gpr[rt]>>>0; const cnt=this.cp0Registers[9]>>>0;
    if(writes.length<40)writes.push({pc:pc.toString(16),val:val.toString(16),cnt:cnt.toString(16),diff:((cnt-val)|0)});
    n++;
  }
  return origStep();
};
for(let s=0;s<3000000;s++)cpu.step();
console.log('total mtc0 Compare writes:',n);
console.log('first 40 (val=Compare written, cnt=Count now, diff=cnt-val):');
for(const w of writes)console.log('  pc=0x'+w.pc,'Compare=0x'+w.val,'Count=0x'+w.cnt,'diff='+w.diff);
