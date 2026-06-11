const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=__dirname;
function build(cpuFile){
 let c='';for(const f of ['memory.js','mmu.js','rcp.js',cpuFile])c+=fs.readFileSync(path.join(ROOT,f),'utf8')+'\n';
 c+='\nthis.__classes={Memory,MMU,RCP,CPU};\n';
 const sb={console:{log:()=>{}},setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
 vm.createContext(sb);vm.runInContext(c,sb,{filename:cpuFile});
 const{Memory,MMU,RCP,CPU}=sb.__classes;
 const romBuf=fs.readFileSync(path.join(ROOT,'Super Mario 64 (Europe) (En,Fr,De).n64'));
 const ab=romBuf.buffer.slice(romBuf.byteOffset,romBuf.byteOffset+romBuf.byteLength);
 const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,new sb.Uint8Array(320*240*4));const cpu=new CPU(mmu,rcp);
 mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;cpu.performHleBoot();
 return cpu;
}
const A=build('cpu_pre_dshift_backup.js');
const B=build('cpu.js');
const N=parseInt(process.env.MAX||'30000000');
for(let s=0;s<N;s++){
 const pa=A.pc>>>0,pb=B.pc>>>0;
 if(pa!==pb){ console.log('DIVERGE pc @step',s,'old=0x'+pa.toString(16),'new=0x'+pb.toString(16)); 
   // dump gprs
   for(let r=0;r<32;r++){if((A.gpr[r]|0)!==(B.gpr[r]|0))console.log('  gpr['+r+'] old=0x'+(A.gpr[r]>>>0).toString(16)+' new=0x'+(B.gpr[r]>>>0).toString(16));}
   break; }
 A.step();B.step();
 if(s%2000000===0)console.log('  ...',s,'pc=0x'+pa.toString(16));
}
console.log('done');
