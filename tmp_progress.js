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
const MAX=parseInt(process.argv[2]||'200000000',10);
const BUDGET=parseInt(process.env.BUDGET_MS||'40000',10);
const PRESS=process.env.PRESS==='1';
const t0=Date.now();let lastReport=t0;let hit96=0;let pressed=false;
for(let s=0;s<MAX;s++){
  try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
  if((s&0x3FFFF)===0){
    const f3d=rcp.f3dTaskCount|0;
    const now=Date.now();
    if(f3d>=96&&!hit96)hit96=s;
    if(PRESS&&hit96&&!pressed&&s>hit96+2000000){mmu.updateController(0x1000,0,0);pressed=true;realLog('[press START] step',s);}
    if(now-lastReport>4000){
      realLog('step',s,'f3d',f3d,'tri',(rcp.drawStats&&rcp.drawStats.triangles)|0,'vi=0x'+((mmu.viRegisters[1]&0x7FFFFF)>>>0).toString(16),'ch0',mmu.controllerDebug.channel0Cmds,'btnReads',mmu.controllerDebug.buttonReads);
      lastReport=now;
    }
    if(now-t0>BUDGET){realLog('[budget]',s);break;}
  }
}
realLog('FINAL f3d',rcp.f3dTaskCount,'ch0Cmds',mmu.controllerDebug.channel0Cmds,'btnReads',mmu.controllerDebug.buttonReads,'hit96@',hit96);
