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
const WATCH=(0x8009a3d8+0x1c)&0x7FFFFF;
const MAX=27000000, WARM=20000000;
for(let s=0;s<WARM;s++)cpu.step();
let last=rd(WATCH);
console.log('warm done, watch start value=0x'+last.toString(16));
for(let s=WARM;s<MAX;s++){
  const pc=cpu.pc>>>0;
  cpu.step();
  const cur=rd(WATCH);
  if(cur!==last){ console.log('WRITE step',s,'pc=0x'+pc.toString(16),'0x'+last.toString(16),'->0x'+cur.toString(16)); last=cur; }
  if(pc===0x8018c2c8){
    let f='';let a=cpu.gpr[4]>>>0&0x7FFFFF;for(let i=0;i<60;i++){const ch=b[a+i];if(!ch)break;f+=String.fromCharCode(ch);}
    if(f.indexOf('does not support')>=0){ console.log('PANIC step',s,'final watch=0x'+rd(WATCH).toString(16)); break; }
  }
}
