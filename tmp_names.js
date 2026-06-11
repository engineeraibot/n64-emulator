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
function rstr(a){let s='';a&=0x7FFFFF;if(a===0)return '(null)';for(let i=0;i<32;i++){const ch=b[a+i];if(!ch)break;if(ch<32||ch>126){s+='\\x'+ch.toString(16);}else s+=String.fromCharCode(ch);}return s;}
const MAX=26200000, WARM=25800000;
for(let s=0;s<WARM;s++)cpu.step();
for(let s=WARM;s<MAX;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x80185c2c){ realLog('d_use_obj @step',s,'name a0=0x'+(cpu.gpr[4]>>>0).toString(16),'str="'+rstr(cpu.gpr[4]>>>0)+'"'); }
  if(pc===0x80183540){ realLog('  lookup @step',s,'name a0=0x'+(cpu.gpr[4]>>>0).toString(16),'str="'+rstr(cpu.gpr[4]>>>0)+'"'); }
  if(pc===0x80183ff4){ const obj=cpu.gpr[5]>>>0; realLog('d_attach_to @step',s,'flags=0x'+(cpu.gpr[4]>>>0).toString(16),'obj=0x'+obj.toString(16),'id='+rh(obj+0x10),'objNameField? +0x8=0x'+rd(obj+0x8).toString(16)); }
  if(pc===0x8018c2c8){let f='';let a=cpu.gpr[4]>>>0&0x7FFFFF;for(let i=0;i<60;i++){const ch=b[a+i];if(!ch)break;f+=String.fromCharCode(ch);}
    if(f.indexOf('does not support')>=0){ realLog('PANIC @step',s); break; }}
  cpu.step();
}
