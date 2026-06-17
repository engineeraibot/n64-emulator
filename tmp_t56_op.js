process.env.ROM='Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.INSTATE||'state_oot_scene',ram,mmu,cpu,rcp);
// hook processDisplayList to dump opcode histogram for F3DEX2 frames
const opHist={};
let dlDepth=0;
const origRead=rcp.resolveAddress?rcp.resolveAddress.bind(rcp):null;
// Instead, instrument the command loop by wrapping handleG_* ? simpler: monkeypatch mmu reads? 
// Easiest: hook the big switch via a counter the code already exposes? Not present.
// We'll tap processDisplayList: re-walk the DL ourselves reading words.
const oP=rcp.processDisplayList.bind(rcp);
let captured=false, capStart=0;
rcp.processDisplayList=function(addr,d){
  if(rcp.rspState.isF3DEX2 && !captured){
    // walk a copy
    let pc=addr,depth=0,stack=[],n=0;
    try{
      while(n++<200000){
        const hi=mmu.read32(pc)>>>0, lo=mmu.read32(pc+4)>>>0; pc+=8;
        const cmd=(hi>>>24)&0xFF;
        opHist[cmd]=(opHist[cmd]||0)+1;
        if(cmd===0xDF){ if(depth>0){depth--;pc=stack.pop();} else break; }
        else if(cmd===0xDE){ const noPush=(hi>>>16)&0xFF; const nx=rcp.resolveAddress(lo); if(!noPush){stack.push(pc);depth++;} pc=nx; }
      }
    }catch(e){}
    captured=true;
  }
  return oP(addr,d);
};
const t0=Date.now();const startF=rcp.f3dex2TaskCount|0;
for(let s=0;s<500000000;s++){cpu.step();
  if((s&0x3FFF)===0){if((rcp.f3dex2TaskCount|0)-startF>=30)break;if(Date.now()-t0>40000)break;}}
const ents=Object.entries(opHist).sort((a,b)=>b[1]-a[1]);
for(const [c,n] of ents) console.error('cmd 0x'+(+c).toString(16),'x',n);
