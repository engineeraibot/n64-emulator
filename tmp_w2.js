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
const SUB=0x8009a3d8;
function dumplist(tag){
  let node=rd(SUB+0x1c);
  realLog(tag,'SUB->list head=0x'+node.toString(16));
  let cnt=0;
  while(node && cnt<20){
    const obj=rd(node+0x8);
    realLog('   node 0x'+node.toString(16)+' next=0x'+rd(node+0x4).toString(16)+' obj=0x'+obj.toString(16)+' obj.id='+rh(obj+0x10)+' obj.type=0x'+rd(obj+0xC).toString(16));
    node=rd(node+0x4); cnt++;
  }
}
let inCheck=0, checkA0=0,checkA1=0;
for(let s=0;s<MAX;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x8017ce2c){ // membership reader entry
    const a0=cpu.gpr[4]>>>0,a1=cpu.gpr[5]>>>0;
    if(a0===SUB){ realLog('--- membership check @step',s,'a0=0x'+a0.toString(16),'a1=0x'+a1.toString(16),'a1.id='+rh(a1+0x10),'a1.type=0x'+rd(a1+0xC).toString(16)); dumplist('  list-at-check:'); inCheck=1; }
  }
  if(inCheck && pc===0x8017cea8){ realLog('  membership RETURN v0=',cpu.gpr[2]|0,'@step',s); inCheck=0; }
  if(pc===0x8017cc8c){ realLog('+++ APPEND write @step',s,'storing node into list, t-reg vals: a0=0x'+(cpu.gpr[4]>>>0).toString(16)); }
  // panic detection
  if(pc===0x8018c2c8){
    let f='';let a=cpu.gpr[4]>>>0&0x7FFFFF;for(let i=0;i<60;i++){const ch=b[a+i];if(!ch)break;f+=String.fromCharCode(ch);}
    if(f.indexOf('does not support')>=0){ realLog('### PANIC @step',s); dumplist('  list-at-panic:'); break; }
  }
  cpu.step();
}
