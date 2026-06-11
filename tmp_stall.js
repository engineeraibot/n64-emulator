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
const TOTAL=parseInt(process.env.TOTAL||'37000000',10);
const SAMPLE_FROM=parseInt(process.env.SAMPLE_FROM||'32000000',10);
let curThread=0;const hist=new Map();const recvQ=new Map();
let f3dMile=[];let lastF3d=0;
for(let s=0;s<TOTAL;s++){
  const pc=cpu.pc>>>0;
  if(pc===0x802f40b0)curThread=cpu.gpr[26]>>>0;
  if(s>=SAMPLE_FROM){
    if((s&3)===0)hist.set(pc,(hist.get(pc)||0)+1);
    if(pc===0x802ef780){const q=cpu.gpr[4]>>>0;const k=(curThread>>>0).toString(16)+':'+q.toString(16);recvQ.set(k,(recvQ.get(k)||0)+1);}
  }
  cpu.step();
  const f=rcp.f3dTaskCount|0;if(f!==lastF3d){f3dMile.push((s/1e6).toFixed(1)+'M:'+f);lastF3d=f;}
}
console.log('f3d milestones (last 8):',f3dMile.slice(-8).join(' '));
console.log('controllerDebug:',JSON.stringify(mmu.controllerDebug));
console.log('siRegisters:',Array.from(mmu.siRegisters).map(x=>'0x'+(x>>>0).toString(16)).join(','));
const top=[...hist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12);
console.log('PC hist (from '+(SAMPLE_FROM/1e6)+'M):');for(const[p,n]of top)console.log('  0x'+p.toString(16),n);
console.log('osRecvMesg thread:queue:');for(const[k,n]of recvQ)console.log('  '+k,'x'+n);
