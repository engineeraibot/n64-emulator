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
const MAX=26200000;
let calls=[];
for(let s=0;s<MAX;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x80183ff4){
    const flags=cpu.gpr[4]>>>0, obj=cpu.gpr[5]>>>0;
    const g=rd(0x801a7784);
    calls.push({s,flags:flags.toString(16),obj:obj.toString(16),objType:rd(obj+0xC).toString(16),objId:rh(obj+0x10),grp:rd(obj+0x30).toString(16),global:g.toString(16),gType:rd(g+0xC).toString(16),gId:rh(g+0x10)});
    if(calls.length>200){realLog('too many');break;}
  }
  if(pc===0x8018c2c8){
    let f='';let a=cpu.gpr[4]>>>0&0x7FFFFF;for(let i=0;i<60;i++){const ch=b[a+i];if(!ch)break;f+=String.fromCharCode(ch);}
    if(f.indexOf('does not support')>=0){ realLog('PANIC @step',s); break; }
  }
  cpu.step();
}
realLog('total 0x80183ff4 calls:',calls.length);
realLog('last 12 calls:');
for(const c of calls.slice(-12)) realLog(JSON.stringify(c));
