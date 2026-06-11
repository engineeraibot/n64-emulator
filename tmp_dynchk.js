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
const dv=new DataView(ram.rdram);
let n=0;
for(let s=0;s<25100000;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x80182b74){ // after lw s0,0(t6); xori done. t6=gpr14, s0=gpr16
    const t6=cpu.gpr[14]>>>0, s0=cpu.gpr[16]>>>0;
    n++;
    if(n<=6||(s0>>>0)!==0xd1d4){
      const p=t6&0x7FFFFF;
      const w0=dv.getUint32(p,false)>>>0, w1=dv.getUint32((p+4)&0x7FFFFF,false)>>>0;
      console.log('proc_dynlist#'+n+' ptr=0x'+t6.toString(16)+' dynlist[0]=0x'+s0.toString(16)+' mem[0]=0x'+w0.toString(16)+' mem[1]=0x'+w1.toString(16)+' f3d='+(rcp.f3dTaskCount|0));
      if((s0>>>0)!==0xd1d4){console.log('  >>> MISMATCH (expected 0xd1d4)'); break;}
    }
  }
  cpu.step();
}
console.log('total proc_dynlist checks:',n);
