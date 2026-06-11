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
const b=new Uint8Array(ram.rdram);
function rd(a){a&=0x7FFFFF;return (b[a]<<24|b[a+1]<<16|b[a+2]<<8|b[a+3])>>>0;}
function str(a){a=a>>>0;a&=0x7FFFFF;let s='';for(let i=0;i<48;i++){const ch=b[a+i];if(ch===0)break;s+=(ch>=32&&ch<127)?String.fromCharCode(ch):'.';}return s;}
const MAX=27000000;
let done=false;
// also count how many times dGetWorldPos is entered (0x80187bac) and the type each time
let entries=0; const typeHist={};
for(let s=0;s<MAX;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x80187bac){
    const objp=rd(0x801a7784);
    const type=rd(objp+0xC);
    typeHist[type]=(typeHist[type]||0)+1; entries++;
  }
  if(pc===0x8018c2c8 && /does not support/.test(str(cpu.gpr[4])) && !done){
    done=true;
    const objp=rd(0x801a7784);
    console.log('PANIC step',s,'entries so far',entries);
    console.log('current-obj global *0x801a7784 = 0x'+objp.toString(16));
    console.log('obj header:');
    for(let o=0;o<0x20;o+=4)console.log('  +0x'+o.toString(16)+' = 0x'+rd(objp+o).toString(16));
    console.log('obj->type(+0xC)=0x'+rd(objp+0xC).toString(16),' name-global *0x801b9460=0x'+rd(0x801b9460).toString(16),'="'+str(rd(0x801b9460))+'"');
    console.log('typeHist of dGetWorldPos calls:',JSON.stringify(typeHist));
    break;
  }
  cpu.step();
}
