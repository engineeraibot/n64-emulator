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
let prev=cpu.cp0Registers[12]|0; let logs=0;
for(let s=0;s<2100000;s++){
  const pcb=cpu.pc>>>0;
  try{cpu.step();}catch(e){console.log('threw',e.message);break;}
  const cur=cpu.cp0Registers[12]|0;
  if(cur!==prev){
    if(logs<70){logs++;console.log('step',s,'PCbefore=0x'+pcb.toString(16),'Status 0x'+(prev>>>0).toString(16),'-> 0x'+(cur>>>0).toString(16));}
    prev=cur;
  }
  if((cpu.pc>>>0)===0x80242e54){console.log('=> idle spin entered at step',s,'final Status=0x'+(cur>>>0).toString(16));break;}
}
