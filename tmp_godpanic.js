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
const R=['zero','at','v0','v1','a0','a1','a2','a3','t0','t1','t2','t3','t4','t5','t6','t7','s0','s1','s2','s3','s4','s5','s6','s7','t8','t9','k0','k1','gp','sp','fp','ra'];
function str(a){a&=0x7FFFFF;let s='';for(let i=0;i<80;i++){const ch=b[a+i];if(ch===0)break;s+=(ch>=32&&ch<127)?String.fromCharCode(ch):'.';}return s;}
const MAX=parseInt(process.argv[2]||'27000000');
let out='';let lastPrintStep=-1;
let ringPC=new Array(32).fill(0),ri=0;
for(let s=0;s<MAX;s++){
  const pc=cpu.pc>>>0;
  ringPC[ri]=pc; ri=(ri+1)&31;
  // panic char printer
  if(pc===0x8018c534){ const t2=cpu.gpr[10]>>>0; const ch=b[t2&0x7FFFFF]; if(ch) out+=(ch>=32&&ch<127)?String.fromCharCode(ch):(ch===10?'|':'.'); lastPrintStep=s; }
  // goddard fatal exit
  if(pc===0x8019ab3c){
    console.log('=== goddard exit() at step',s,'===');
    console.log('panic msg:',JSON.stringify(out.slice(-220)));
    console.log('regs: a0=0x'+(cpu.gpr[4]>>>0).toString(16),'a1=0x'+(cpu.gpr[5]>>>0).toString(16),'a2=0x'+(cpu.gpr[6]>>>0).toString(16),'a3=0x'+(cpu.gpr[7]>>>0).toString(16));
    console.log('  s0=0x'+(cpu.gpr[16]>>>0).toString(16),'s1=0x'+(cpu.gpr[17]>>>0).toString(16),'s2=0x'+(cpu.gpr[18]>>>0).toString(16),'ra=0x'+(cpu.gpr[31]>>>0).toString(16));
    // recent PCs
    let pcs=[];for(let k=0;k<32;k++){pcs.push('0x'+ringPC[(ri+k)&31].toString(16));}
    console.log('recent PCs:',pcs.join(' '));
    break;
  }
  cpu.step();
}
if(lastPrintStep<0)console.log('no panic char print; out=',JSON.stringify(out.slice(-220)));
