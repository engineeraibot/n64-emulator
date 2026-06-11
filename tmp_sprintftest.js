const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=__dirname;
let c='';for(const f of ['memory.js','mmu.js','rcp.js','cpu.js'])c+=fs.readFileSync(path.join(ROOT,f),'utf8')+'\n';
c+='\nthis.__classes={Memory,MMU,RCP,CPU};\n';
const realLog=console.log;
const sb={console:{log:()=>{}},setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
vm.createContext(sb);vm.runInContext(c,sb,{filename:'c.js'});
const{Memory,MMU,RCP,CPU}=sb.__classes;
const romBuf=fs.readFileSync(path.join(ROOT,'Super Mario 64 (Europe) (En,Fr,De).n64'));
const ab=romBuf.buffer.slice(romBuf.byteOffset,romBuf.byteOffset+romBuf.byteLength);
const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,new sb.Uint8Array(320*240*4));const cpu=new CPU(mmu,rcp);
mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;cpu.performHleBoot();
const b=new Uint8Array(ram.rdram);
function rstr(a){let s='';a&=0x7FFFFF;for(let i=0;i<24;i++){const ch=b[a+i];if(!ch)break;if(ch<32||ch>126)s+='\\x'+ch.toString(16);else s+=String.fromCharCode(ch);}return s;}
for(let s=0;s<26000000;s++)cpu.step();
// scratch buffer + fmt string we write ourselves
const BUF=0x80260000, FMT=0x80260100;
function wstr(a,str){a&=0x7FFFFF;for(let i=0;i<str.length;i++)b[a+i]=str.charCodeAt(i);b[a+str.length]=0;}
function callSprintf(val){
  wstr(FMT,'N%d');
  cpu.gpr[4]=BUF|0; cpu.gpr[5]=FMT|0; cpu.gpr[6]=val|0;
  cpu.gpr[31]=0x80400000|0; // sentinel ra
  cpu.pc=0x802efd04;
  let guard=0;
  while((cpu.pc>>>0)!==0x80400000 && guard<2000000){cpu.step();guard++;}
  return rstr(BUF)+' (steps '+guard+')';
}
for(const v of [24,22,23,7,0,1,100,46]) realLog('N%d of',v,'=>',JSON.stringify(callSprintf(v)));
