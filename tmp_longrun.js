const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=__dirname;
let c='';for(const f of ['memory.js','mmu.js','rcp.js','cpu.js'])c+=fs.readFileSync(path.join(ROOT,f),'utf8')+'\n';
c+='\nthis.__classes={Memory,MMU,RCP,CPU};\n';
const sb={console:{log:()=>{}},setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
vm.createContext(sb);vm.runInContext(c,sb,{filename:'c.js'});
const{Memory,MMU,RCP,CPU}=sb.__classes;
const romBuf=fs.readFileSync(path.join(ROOT,'Super Mario 64 (Europe) (En,Fr,De).n64'));
const ab=romBuf.buffer.slice(romBuf.byteOffset,romBuf.byteOffset+romBuf.byteLength);
const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,new sb.Uint8Array(320*240*4));const cpu=new CPU(mmu,rcp);
mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;cpu.performHleBoot();
const t0=Date.now();
let s=0; const MAX=parseInt(process.env.MAX||'120000000');
let lastf=0;
while(s<MAX){ cpu.step(); s++;
  if((s&0x3FFFFF)===0){ const f=rcp.f3dTaskCount|0; if(f!==lastf){console.log('step',s,'f3d',f,'count=0x'+(cpu.cp0Registers[9]>>>0).toString(16));lastf=f;}
    if(Date.now()-t0>40000){console.log('time budget hit at step',s,'count=0x'+(cpu.cp0Registers[9]>>>0).toString(16),'f3d',f);break;} }
}
console.log('FINAL step',s,'f3d',rcp.f3dTaskCount|0,'count=0x'+(cpu.cp0Registers[9]>>>0).toString(16));
