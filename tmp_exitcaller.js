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
const TOTAL=parseInt(process.env.TOTAL||'27000000',10);
const ring=[];let done=false;
for(let s=0;s<TOTAL;s++){
  const pc=cpu.pc>>>0;
  if(!done){ ring.push(pc); if(ring.length>40)ring.shift(); }
  if(!done && pc===0x8019ab3c){
    console.log('ENTER exit() at step',s,'ra=0x'+(cpu.gpr[31]>>>0).toString(16),'a0=0x'+(cpu.gpr[4]>>>0).toString(16),'f3d='+(rcp.f3dTaskCount|0));
    console.log('recent PCs:',ring.map(x=>'0x'+x.toString(16)).join(' '));
    done=true;
  }
  cpu.step();
}
if(!done)console.log('exit() never entered within',TOTAL,'steps; f3d='+(rcp.f3dTaskCount|0));
