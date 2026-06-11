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
const MAX=27000000;
let lastEntryA0=null,lastEntryObj=null;
let preCC=null;
let done=false;
for(let s=0;s<MAX;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x80183ff4){ lastEntryA0=cpu.gpr[4]>>>0; lastEntryObj=cpu.gpr[5]>>>0; }
  if(pc===0x8017cc44){ // capture before
    preCC={ a0:cpu.gpr[4]>>>0, a1:cpu.gpr[5]>>>0, global:rd(0x801a7784), step:s };
  }
  if(pc===0x801841c4){ // right after 0x8017cc44 returns, before the gate
    // log only the one leading to panic: check current obj type
    const g=rd(0x801a7784);
    if(rd(g+0xC)===0x10000){
      console.log('--- at gate (0x801841c4), pre-panic ---');
      console.log('func 0x80183ff4 entry a0(flags)=0x'+(lastEntryA0>>>0).toString(16),'obj(a1)=0x'+(lastEntryObj>>>0).toString(16));
      console.log('flags & 9 =',(lastEntryA0&9));
      console.log('obj=0x'+lastEntryObj.toString(16),'type=0x'+rd(lastEntryObj+0xC).toString(16));
      console.log('obj+0x30=0x'+rd(lastEntryObj+0x30).toString(16),'(sp+72 sub-obj source)');
      console.log('current-obj global now=0x'+g.toString(16),'type=0x'+rd(g+0xC).toString(16));
      if(preCC)console.log('0x8017cc44 call: a0=0x'+preCC.a0.toString(16),'a1=0x'+preCC.a1.toString(16),'global-before=0x'+preCC.global.toString(16));
    }
  }
  if(pc===0x8018c2c8){
    // panic printf
    let f='';let a=cpu.gpr[4]>>>0&0x7FFFFF;for(let i=0;i<60;i++){const ch=b[a+i];if(!ch)break;f+=String.fromCharCode(ch);}
    if(/does not support/.test(f)){ console.log('PANIC reached step',s); done=true; break; }
  }
  cpu.step();
}
if(!done)console.log('no panic');
