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
// Watch Status (cp0[12]) transitions by polling each step (cheap enough for a window).
let prev=cpu.cp0Registers[12]|0; let log=[]; let count=0;
const origCOP0=cpu.opCOP0.bind(cpu);
cpu.opCOP0=function(i,pc,ds){
  const sub=(i>>21)&0x1F, rd=(i>>11)&0x1F;
  const isMTC0=(sub===0x04||sub===0x05)&&rd===12;
  const isERET=(sub>=0x10)&&((i&0x3F)===0x18);
  const before=this.cp0Registers[12]|0;
  const r=origCOP0(i,pc,ds);
  const after=this.cp0Registers[12]|0;
  if((isMTC0||isERET)&&before!==after&&count<60){
    count++;
    console.log((isERET?'ERET':'MTC0'),'PC=0x'+(pc>>>0).toString(16),'Status 0x'+(before>>>0).toString(16),'-> 0x'+(after>>>0).toString(16),'a0(gpr4)=0x'+(this.gpr[4]>>>0).toString(16));
  }
  return r;
};
for(let s=0;s<48000000;s++){try{cpu.step();}catch(e){console.log('threw',e.message);break;} if((cpu.pc>>>0)===0x80242e54){console.log('reached idle spin at step',s,'Status=0x'+(cpu.cp0Registers[12]>>>0).toString(16));break;}}
