// Dump raw G_VTX command words (hi/lo) for MK64 and the current decode,
// distinguishing the streak-fan loads (num3 dest0) from normal loads.
process.env.ROM = process.env.ROM || 'Mario Kart 64 (Europe) (Rev A).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_mk64_race', ram, mmu, cpu, rcp);
const log=console.error.bind(console);
const startF=rcp.f3dTaskCount|0;
const STOP=startF+parseInt(process.env.ADV||'2',10);
let auditOn=false;
const hist=new Map(); // key=hi pattern -> count
const origVtx=rcp.handleG_VTX.bind(rcp);
let n=0;
rcp.handleG_VTX=function(hi,lo){
  if(auditOn){
    let num=((hi&0xFFFF)>>>4)&0x3F, dest=(hi>>>16)&0xF;
    const key=`hi=0x${(hi>>>0).toString(16).padStart(8,'0')} low16=0x${(hi&0xFFFF).toString(16)} -> F3Ddecode num${num} dest${dest}`;
    hist.set(key,(hist.get(key)||0)+1);
  }
  return origVtx(hi,lo);
};
for(let s=0;s<400000000;s++){
  try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dTaskCount|0; auditOn=(f>=STOP-1); if(f>=STOP)break;}
}
for(const [k,c] of [...hist.entries()].sort((a,b)=>b[1]-a[1])) log(`n=${c}  ${k}`);
