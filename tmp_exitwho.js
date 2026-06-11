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
function str(a){a=a>>>0;a&=0x7FFFFF;let s='';for(let i=0;i<90;i++){const ch=b[a+i];if(ch===0)break;s+=(ch>=32&&ch<127)?String.fromCharCode(ch):'.';}return s;}
const MAX=27000000;
let ring=[];
for(let s=0;s<MAX;s++){
  const pc=cpu.pc>>>0;
  const w=(b[(pc&0x7FFFFF)]<<24|b[(pc&0x7FFFFF)+1]<<16|b[(pc&0x7FFFFF)+2]<<8|b[(pc&0x7FFFFF)+3])>>>0;
  const op=w>>>26;
  if(s>26153000){
    if(op===0x03){ const t=((0x80000000)|((w&0x3ffffff)<<2))>>>0; ring.push({s,from:pc,to:t}); if(ring.length>40)ring.shift(); }
    else if(op===0 && (w&0x3f)===0x09){ const rs=(w>>21)&31; ring.push({s,from:pc,to:cpu.gpr[rs]>>>0,jalr:1}); if(ring.length>40)ring.shift(); }
  }
  if(pc===0x8019ab3c){
    console.log('exit print at step',s,'; recent jal/jalr chain:');
    for(const r of ring)console.log('  s'+r.s+' '+(r.jalr?'jalr':'jal ')+' 0x'+r.from.toString(16)+' -> 0x'+r.to.toString(16));
    break;
  }
  cpu.step();
}
