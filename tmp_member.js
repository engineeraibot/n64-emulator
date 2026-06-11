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
function rh(a){a&=0x7FFFFF;return ((b[a]<<8|b[a+1])<<16>>16);} // signed halfword big-endian
const MAX=27000000;
let dumped=false;
for(let s=0;s<MAX;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x8017ce2c && !dumped){
    const a0=cpu.gpr[4]>>>0, a1=cpu.gpr[5]>>>0;
    const g=rd(0x801a7784);
    if(rd(g+0xC)===0x10000){
      dumped=true;
      console.log('membership check: a0=0x'+a0.toString(16),'(type 0x'+rd(a0+0xC).toString(16)+')  a1=0x'+a1.toString(16),'(type 0x'+rd(a1+0xC).toString(16)+')');
      console.log('a1->id (lh +0x10) =',rh(a1+0x10),' a1+0x10 word=0x'+rd(a1+0x10).toString(16));
      let node=rd(a0+0x1c);
      console.log('a0->list (a0+0x1c) head = 0x'+node.toString(16));
      let cnt=0;
      while(node && cnt<40){
        const obj=rd(node+0x8);
        const id=rh(obj+0x10);
        console.log('  node 0x'+node.toString(16)+' -> obj 0x'+obj.toString(16)+' id='+id+' type=0x'+rd(obj+0xC).toString(16));
        node=rd(node+0x4); cnt++;
      }
      // don't break; let it run to see v0 returned
    }
  }
  if(dumped && pc===0x8017cea8){ console.log('RETURN v0=',cpu.gpr[2]|0); break; }
  cpu.step();
}
