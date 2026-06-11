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
let fires=0; let fireLog=[];
const oSvc=cpu.serviceCompareTimer.bind(cpu);
cpu.serviceCompareTimer=function(){
  const wasArmed=this._compareArmed, before=this.cp0Registers[13]&0x8000;
  oSvc();
  const after=this.cp0Registers[13]&0x8000;
  if(!before && after){fires++; if(fireLog.length<25)fireLog.push({ic:this.instructionCount,Count:(this.cp0Registers[9]>>>0).toString(16),Compare:(this.cp0Registers[11]>>>0).toString(16)});}
};
for(let s=0;s<30000000;s++)cpu.step();
console.log('timer fires:',fires,' f3d=',rcp.f3dTaskCount|0,' finalInstrCount=',cpu.instructionCount);
console.log('first 25 fires:');
for(const f of fireLog)console.log('  ic='+f.ic,'Count=0x'+f.Count,'Compare=0x'+f.Compare);
