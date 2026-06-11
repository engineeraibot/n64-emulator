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
const GAME=0x80308d40;
const timeline=[]; // {step, resumePC}
for(let s=0;s<90000000;s++){
  if((cpu.pc>>>0)===0x802f40b0){
    const k0=cpu.gpr[26]>>>0;
    if(k0===GAME){const phys=(k0+284)&0x7FFFFF; const ctxpc=rd.getUint32(phys,false)>>>0;
      timeline.push({s,pc:ctxpc>>>0});}
  }
  cpu.step();
}
console.log('game thread dispatches:',timeline.length);
console.log('first 50:');
for(const t of timeline.slice(0,50))console.log('  step',t.s,'resumePC 0x'+t.pc.toString(16));
console.log('last 10:');
for(const t of timeline.slice(-10))console.log('  step',t.s,'resumePC 0x'+t.pc.toString(16));
