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
let arms=[]; let prevArmed=false; let prevCompare=0; let armCount=0;
const oStep=cpu.step.bind(cpu);
cpu.step=function(){
  oStep();
  const armed=this._compareArmed, cmp=this.cp0Registers[11]>>>0, cnt=this.cp0Registers[9]>>>0;
  if(armed && (!prevArmed || cmp!==prevCompare)){ // newly armed (re-arm)
    armCount++;
    if(arms.length<30)arms.push({n:armCount,Compare:cmp.toString(16),Count:cnt.toString(16),diff:((cnt-cmp)|0)});
  }
  prevArmed=armed; prevCompare=cmp;
};
for(let s=0;s<6000000;s++)cpu.step();
console.log('total re-arms:',armCount);
console.log('first 30 re-arms (diff=Count-Compare at arm time):');
for(const a of arms)console.log('  #'+a.n,'Compare=0x'+a.Compare,'Count=0x'+a.Count,'diff='+a.diff);
