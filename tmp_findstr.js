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
for(let s=0;s<25100000;s++)cpu.step();
const b=Buffer.from(ram.rdram);
const needle=Buffer.from('not a valid dyn list');
let idx=0;const hits=[];
while((idx=b.indexOf(needle,idx))!==-1){hits.push(idx);idx++;}
console.log('RDRAM hits for "not a valid dyn list":',hits.map(h=>'0x'+(0x80000000+h>>>0).toString(16)));
for(const h of hits){let st=h;while(st>0&&b[st-1]>=32&&b[st-1]<127)st--;console.log('  full @0x'+(0x80000000+st>>>0).toString(16)+': '+JSON.stringify(b.slice(st,h+22).toString('latin1')));}
// also search ROM
const rb=Buffer.from(ram.rom?ram.rom:new ArrayBuffer(0));
let ri=0;const rhits=[];while(rb.length&&(ri=rb.indexOf(needle,ri))!==-1){rhits.push(ri);ri++;}
console.log('ROM hits:',rhits.map(h=>'0x'+h.toString(16)));
