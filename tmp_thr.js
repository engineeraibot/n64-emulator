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
const rd=new DataView(ram.rdram);
let logs=0;
for(let s=0;s<2000000;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x802f40b0){ // about to mtc0 Status from k1; k0=gpr[26] is thread ptr
    const k0=cpu.gpr[26]>>>0; const k1=cpu.gpr[27]>>>0;
    const ctxSrAddr=(k0+280)>>>0; const phys=ctxSrAddr&0x7FFFFF;
    const savedSr=rd.getUint32(phys,false)>>>0;
    if((k1&~0xff00)===0x2 || savedSr===0x2 || logs<8){
      if(logs<25){logs++;console.log('step',s,'thread(k0)=0x'+k0.toString(16),'savedSR@+280=0x'+savedSr.toString(16),'k1(newStatus)=0x'+k1.toString(16));}
    }
  }
  try{cpu.step();}catch(e){console.log('threw',e.message);break;}
  if(pc===0x80242e54){console.log('idle spin at step',s);break;}
}
