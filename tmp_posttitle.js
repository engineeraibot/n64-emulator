const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=__dirname;
const ROM=path.join(ROOT,'Super Mario 64 (Europe) (En,Fr,De).n64');
let c='';for(const f of ['memory.js','mmu.js','rcp.js','cpu.js'])c+=fs.readFileSync(path.join(ROOT,f),'utf8')+'\n';
c+='\nthis.__c={Memory,MMU,RCP,CPU};\n';
const realLog=console.log.bind(console);
const sb={console:{log:()=>{},error:()=>{},warn:()=>{}},setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
vm.createContext(sb);vm.runInContext(c,sb,{filename:'e.js'});
const {Memory,MMU,RCP,CPU}=sb.__c;
const rb=fs.readFileSync(ROM);const ab=rb.buffer.slice(rb.byteOffset,rb.byteOffset+rb.byteLength);
const fb=new Uint8Array(320*240*4);const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,fb);const cpu=new CPU(mmu,rcp);
mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;if(!cpu.isHleBootDone)cpu.performHleBoot();
const BUDGET=parseInt(process.env.BUDGET_MS||'41000',10);
const t0=Date.now();let phase=0;const hist=new Map();let sampled=0;let startSample=0;
for(let s=0;;s++){
  try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
  if(phase===0){
    if((rcp.f3dTaskCount|0)>=96){phase=1;startSample=s;realLog('reached f3d96 at step',s,'t',(Date.now()-t0)/1000);}
    else if((s&0xFFFF)===0 && Date.now()-t0>BUDGET-3000){realLog('never reached 96, f3d',rcp.f3dTaskCount|0,'step',s);break;}
  } else {
    const pc=cpu.pc>>>0; hist.set(pc,(hist.get(pc)||0)+1); sampled++;
    if((s&0xFFFF)===0 && Date.now()-t0>BUDGET){realLog('sample stop at step',s,'sampled',sampled,'f3dNow',rcp.f3dTaskCount|0);break;}
  }
}
realLog('f3d final',rcp.f3dTaskCount|0,'ch0',mmu.controllerDebug.channel0Cmds);
const top=[...hist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15);
realLog('--- top PCs after f3d96 ---');
for(const[pc,n]of top)realLog('0x'+pc.toString(16),n);
