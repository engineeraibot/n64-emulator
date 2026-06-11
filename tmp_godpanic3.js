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
function str(a){a=a>>>0;a&=0x7FFFFF;let s='';for(let i=0;i<120;i++){const ch=b[a+i];if(ch===0)break;s+=(ch>=32&&ch<127)?String.fromCharCode(ch):'.';}return s;}
const MAX=parseInt(process.argv[2]||'27000000');
// Hook the two printf entries; whenever called, log format + args if format looks like the panic.
const ENTRIES=[0x8018c258,0x8018c2c8,0x8019a900,0x8019a914];
let seen=new Set();
for(let s=0;s<MAX;s++){
  const pc=cpu.pc>>>0;
  if(ENTRIES.includes(pc)){
    const fmt=str(cpu.gpr[4]);
    if(/Object|support|dyn list|valid|fault|error|Error|%d/i.test(fmt)){
      const key=pc+'|'+fmt;
      if(!seen.has(key)){ seen.add(key);
        console.log('step',s,'pc=0x'+pc.toString(16),'fmt="'+fmt+'"');
        console.log('   a1=0x'+(cpu.gpr[5]>>>0).toString(16)+' ["'+str(cpu.gpr[5])+'"] a2=0x'+(cpu.gpr[6]>>>0).toString(16)+' ('+(cpu.gpr[6]|0)+') a3=0x'+(cpu.gpr[7]>>>0).toString(16)+' ra=0x'+(cpu.gpr[31]>>>0).toString(16));
      }
    }
  }
  if(pc===0x8019ab3c){ console.log('=== exit() step',s,'==='); break; }
  cpu.step();
}
