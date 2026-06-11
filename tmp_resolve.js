const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=__dirname;
let c='';for(const f of ['memory.js','mmu.js','rcp.js','cpu.js'])c+=fs.readFileSync(path.join(ROOT,f),'utf8')+'\n';
c+='\nthis.__classes={Memory,MMU,RCP,CPU};\n';
const realLog=console.log;
const sb={console:{log:()=>{}},setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
vm.createContext(sb);vm.runInContext(c,sb,{filename:'c.js'});
const{Memory,MMU,RCP,CPU}=sb.__classes;
const romBuf=fs.readFileSync(path.join(ROOT,'Super Mario 64 (Europe) (En,Fr,De).n64'));
const ab=romBuf.buffer.slice(romBuf.byteOffset,romBuf.byteOffset+romBuf.byteLength);
const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,new sb.Uint8Array(320*240*4));const cpu=new CPU(mmu,rcp);
mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;cpu.performHleBoot();
const b=new Uint8Array(ram.rdram);
function rd(a){a&=0x7FFFFF;return (b[a]<<24|b[a+1]<<16|b[a+2]<<8|b[a+3])>>>0;}
function rh(a){a&=0x7FFFFF;return ((b[a]<<8|b[a+1])<<16>>16);}
function rstr(a){let s='';a>>>=0;a&=0x7FFFFF;if(a===0)return '(null)';for(let i=0;i<24;i++){const ch=b[a+i];if(!ch)break;if(ch<32||ch>126)s+='\\x'+ch.toString(16);else s+=String.fromCharCode(ch);}return s;}
const MAX=26160000, WARM=25900000;
for(let s=0;s<WARM;s++)cpu.step();
let entrySp=0, curId=0;
for(let s=WARM;s<MAX;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x80183540){ entrySp=cpu.gpr[29]>>>0; curId=cpu.gpr[4]>>>0;
    realLog('RESOLVE id=0x'+curId.toString(16),'flagCount=0x'+rd(0x801b945c).toString(16),'intFlag=0x'+rd(0x801a77a0).toString(16)); }
  if(pc===0x801835e8){ // strcmp call: a0=table entry, a1=our name
    const a0=cpu.gpr[4]>>>0,a1=cpu.gpr[5]>>>0;
    realLog('   cmp tableEntry@0x'+a0.toString(16)+'="'+rstr(a0)+'" vs name="'+rstr(a1)+'"');
  }
  if(pc===0x8018363c){ realLog('   => result=0x'+(rd((entrySp+284)&0x7FFFFF)).toString(16)); }
  cpu.step();
}
