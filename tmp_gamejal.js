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
const GAME=0x80308d40; let cur=0;
let log=[];
for(let s=0;s<10000000;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x802f40b0)cur=cpu.gpr[26]>>>0;
  if(cur===GAME){
    const w=cpu.mmu.read32(pc)>>>0; const op=w>>>26;
    if(op===0x03){ // jal
      const tgt=((0x80000000)|((w&0x3ffffff)<<2))>>>0;
      log.push('jal 0x'+tgt.toString(16));
    }
    if(pc===0x802ef780){ // osRecvMesg
      log.push('  RECV q=0x'+(cpu.gpr[4]>>>0).toString(16)+' fl='+(cpu.gpr[6]>>>0));
    }
    if(pc===0x802ef640){ log.push('  ?send640'); }
  }
  cpu.step();
}
// print last 80 entries
console.log('game thread last calls before block:');
for(const e of log.slice(-80))console.log(e);
