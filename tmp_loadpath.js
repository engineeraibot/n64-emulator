const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
let block=0,tileLd=0;const blockTiles={},tileTiles={};
const ob=rcp.handleG_LOADBLOCK.bind(rcp), ot=rcp.handleG_LOADTILE.bind(rcp);
rcp.handleG_LOADBLOCK=function(hi,lo){block++;const t=(lo>>24)&0x7;blockTiles[t]=(blockTiles[t]||0)+1;return ob(hi,lo);};
rcp.handleG_LOADTILE=function(hi,lo){tileLd++;const t=(lo>>24)&0x7;tileTiles[t]=(tileTiles[t]||0)+1;return ot(hi,lo);};
rcp.f3dTaskCount=0;
const t0=Date.now();
for(let s=0;;s++){ try{cpu.step();}catch(e){break;}
  if((s&0x1FFFF)===0){ if((rcp.f3dTaskCount|0)>=2)break; if(Date.now()-t0>40000)break; } }
realLog('LOADBLOCK calls',block,'by tile',JSON.stringify(blockTiles));
realLog('LOADTILE  calls',tileLd,'by tile',JSON.stringify(tileTiles));
