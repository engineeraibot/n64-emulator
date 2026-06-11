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
let viInts=0,lastMi=0,aud=0;
const threads={}; // ptr -> {count, lastResumePC}
let lastSp4=0; const origRun=rcp.runRspTask.bind(rcp);
rcp.runRspTask=function(){const t=this.mmu.spDmemView.getUint32(0xFC0,false)>>>0; if(t===2)aud++; return origRun();};
for(let s=0;s<90000000;s++){
  if((cpu.pc>>>0)===0x802f40b0){ // dispatcher mtc0 status; k0=thread ptr
    const k0=cpu.gpr[26]>>>0; const phys=(k0+284)&0x7FFFFF; const ctxpc=rd.getUint32(phys,false)>>>0;
    if(!threads[k0])threads[k0]={count:0,pcs:new Set()};
    threads[k0].count++; threads[k0].pcs.add(ctxpc>>>0);
  }
  cpu.step();
  const mi=mmu.miRegisters[2]; if((mi&0x08)&&!(lastMi&0x08))viInts++; lastMi=mi;
}
console.log('VI interrupts:',viInts,'audio tasks:',aud,'ratio:',(aud/Math.max(1,viInts)).toFixed(1));
console.log('threads dispatched:');
for(const[ptr,info]of Object.entries(threads)){
  const pcs=[...info.pcs].slice(0,6).map(x=>'0x'+x.toString(16)).join(',');
  console.log('  thread 0x'+(ptr>>>0).toString(16),'dispatched',info.count,'x  resumePCs:',pcs);
}
