const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=__dirname;
const files=['memory.js','mmu.js','rcp.js','cpu.js'];
let combined='';for(const f of files)combined+=fs.readFileSync(path.join(ROOT,f),'utf8')+'\n';
combined+='\nthis.__classes={Memory,MMU,RCP,CPU};\n';
const sandbox={console,setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
vm.createContext(sandbox);vm.runInContext(combined,sandbox,{filename:'c.js'});
const {Memory,MMU,RCP,CPU}=sandbox.__classes;
const romBuf=fs.readFileSync(path.join(ROOT,'Super Mario 64 (Europe) (En,Fr,De).n64'));
const ab=romBuf.buffer.slice(romBuf.byteOffset,romBuf.byteOffset+romBuf.byteLength);
const fb=new sandbox.Uint8Array(320*240*4);
const ram=new Memory(8*1024*1024),mmu=new MMU(ram),rcp=new RCP(mmu,fb),cpu=new CPU(mmu,rcp);
mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;cpu.performHleBoot();
const PRESS_AT=parseInt(process.env.PRESS_AT||'18000000',10);
const TOTAL=parseInt(process.env.TOTAL||'38000000',10);
const START=0x1000;let lastF3d=0;
for(let s=0;s<TOTAL;s++){
  cpu.step();
  if(s>=PRESS_AT){const phase=Math.floor((s-PRESS_AT)/1500000)%2;mmu.updateController(phase===0?START:0,0,0);}
  if((s&0x1FFFFF)===0){const f=rcp.f3dTaskCount|0;if(f!==lastF3d){console.log('step',(s/1e6).toFixed(0)+'M','f3d='+f,'btnReads='+mmu.controllerDebug.buttonReads,'lastBtn=0x'+(mmu.controllerDebug.lastButtons||0).toString(16));lastF3d=f;}}
}
console.log('FINAL f3d='+(rcp.f3dTaskCount|0),'tri='+((rcp.drawStats&&rcp.drawStats.triangles)|0),'btnReads='+mmu.controllerDebug.buttonReads,'ch0Cmds='+mmu.controllerDebug.channel0Cmds,'hist='+JSON.stringify(rcp.taskTypeHistogram||{}));
