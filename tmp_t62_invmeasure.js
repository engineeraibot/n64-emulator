// A/B: does removing the vestigial invalidateCache() call change throughput?
// Mirrors tmp_boot.buildMachine but optionally strips the calls. No repo edits.
const fs=require('fs'),path=require('path'),vm=require('vm');
const {loadState}=require('./tmp_state');
const ROOT=__dirname;
function build(strip){
  const ROM=path.join(ROOT,process.env.ROM||'Super Mario 64 (Europe) (En,Fr,De).n64');
  let c='';
  for(const f of ['memory.js','mmu.js','rcp.js','cpu.js']){
    let s=fs.readFileSync(path.join(ROOT,f),'utf8');
    if(strip && f==='mmu.js'){
      const b=s;
      s=s.replace(/if \(c2d && this\.cpu\) this\.cpu\.invalidateCache\(\);/g,';');
      s=s.replace(/if \(this\.cpu\) this\.cpu\.invalidateCache\(\);/g,';');
      if(s===b) throw new Error('strip matched nothing in mmu.js');
    }
    c+=s+'\n';
  }
  c+='\nthis.__c={Memory,MMU,RCP,CPU};\n';
  const sb={console:{log:()=>{},error:()=>{},warn:()=>{}},setTimeout:()=>{},clearTimeout:()=>{},performance:{now:()=>Date.now()},
    Math,Number,BigInt,JSON,DataView,ArrayBuffer,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Array};
  vm.createContext(sb);vm.runInContext(c,sb,{filename:'e.js'});
  const {Memory,MMU,RCP,CPU}=sb.__c;
  const rb=fs.readFileSync(ROM);const ab=rb.buffer.slice(rb.byteOffset,rb.byteOffset+rb.byteLength);
  const fb=new sb.Uint8Array(320*240*4);
  const ram=new Memory(8*1024*1024);const mmu=new MMU(ram);const rcp=new RCP(mmu,fb);const cpu=new CPU(mmu,rcp);
  mmu.cpu=cpu;mmu.rcp=rcp;ram.loadRom(ab);cpu.isRunning=true;if(!cpu.isHleBootDone)cpu.performHleBoot();
  return {ram,mmu,rcp,cpu};
}
const STATE=process.env.STATE||'state_advfix1';
const N=parseInt(process.env.N||'8000000',10);
function run(strip){
  const m=build(strip);
  loadState(STATE,m.ram,m.mmu,m.cpu,m.rcp);
  for(let i=0;i<300000;i++){try{m.cpu.step();}catch(e){break;}}
  const t0=Date.now();let i=0;
  for(;i<N;i++){try{m.cpu.step();}catch(e){break;}}
  const dt=(Date.now()-t0)/1000;
  return i/dt/1e6;
}
let A=[],B=[];
for(let r=0;r<3;r++){A.push(run(false));B.push(run(true));}
const med=a=>[...a].sort((x,y)=>x-y)[1];
console.log('STATE',STATE,'N',N);
console.log('current  :',A.map(x=>x.toFixed(3)).join(' '),'median',med(A).toFixed(3),'M/s');
console.log('stripped :',B.map(x=>x.toFixed(3)).join(' '),'median',med(B).toFixed(3),'M/s');
console.log('delta',(((med(B)/med(A))-1)*100).toFixed(1)+'%');
