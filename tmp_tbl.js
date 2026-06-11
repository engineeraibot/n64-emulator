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
function rd(a){a&=0x7FFFFF;return (b[a]<<24|b[a+1]<<16|b[a+2]<<8|b[a+3])>>>0;}
function rh(a){a&=0x7FFFFF;return ((b[a]<<8|b[a+1])<<16>>16);}
const MAX=26143000, WARM=25800000;
for(let s=0;s<WARM;s++)cpu.step();
for(let s=WARM;s<MAX;s++)cpu.step();
// dump dynobj name table
const base=rd(0x801a7780);
const cnt=rd(0x801b941c);
realLog('table base=0x'+base.toString(16),'count=0x'+cnt.toString(16),'('+cnt+')');
// print entries; stride 0x14. show entries whose obj(+8?) == 0x80098048, plus indices around 0xda/0xdd
function ent(i){ const e=base+i*0x14; const num=rd(e+0); const namep=rd(e+4); const obj=rd(e+8); return {e,num,namep,obj}; }
let hits=[];
for(let i=0;i<Math.min(cnt,600);i++){ const x=ent(i); if(x.obj===0x80098048) hits.push(i); }
realLog('indices whose +8 == 0x80098048:',JSON.stringify(hits));
for(const i of [0xda,0xdb,0xdc,0xdd,0xde]){ const x=ent(i); realLog('idx 0x'+i.toString(16)+' e=0x'+x.e.toString(16)+' word0=0x'+x.num.toString(16)+' word4=0x'+x.namep.toString(16)+' word8(obj)=0x'+x.obj.toString(16)+(x.obj?(' objType=0x'+rd(x.obj+0xC).toString(16)+' objId='+rh(x.obj+0x10)):'')); }
