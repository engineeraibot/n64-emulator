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
const TOTAL=parseInt(process.env.TOTAL||'30000000',10);
const FROM=parseInt(process.env.FROM||'25000000',10);
const disp=new Map(); let cur=0; const gamePCs=new Map();
const GAME=0x80308d40;
for(let s=0;s<TOTAL;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x802f40b0){cur=cpu.gpr[26]>>>0; if(s>=FROM)disp.set(cur,(disp.get(cur)||0)+1);}
  if(s>=FROM && cur===GAME){gamePCs.set(pc,(gamePCs.get(pc)||0)+1);}
  cpu.step();
}
console.log('dispatch counts per thread ('+(FROM/1e6)+'M-'+(TOTAL/1e6)+'M):');
for(const[t,n]of [...disp.entries()].sort((a,b)=>b[1]-a[1]))console.log('  0x'+t.toString(16),'x'+n);
console.log('game-thread PC histogram while running (top 12):');
for(const[p,n]of [...gamePCs.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12))console.log('  0x'+p.toString(16),n);
console.log('f3d='+(rcp.f3dTaskCount|0));
