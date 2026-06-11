const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState('state_advfix1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
console.log=()=>{};
rcp.f3dTaskCount=0;
const blk={},til={};
const ob=rcp.handleG_LOADBLOCK.bind(rcp), ot=rcp.handleG_LOADTILE.bind(rcp);
rcp.handleG_LOADBLOCK=function(hi,lo){const t=(lo>>24)&7;const tile=rcp.rspState.tiles[t];blk[t+':tmem'+tile.tmem]=(blk[t+':tmem'+tile.tmem]||0)+1;return ob(hi,lo);};
rcp.handleG_LOADTILE=function(hi,lo){const t=(lo>>24)&7;const tile=rcp.rspState.tiles[t];til[t+':tmem'+tile.tmem]=(til[t+':tmem'+tile.tmem]||0)+1;return ot(hi,lo);};
const t0=Date.now();
for(let s=0;;s++){try{cpu.step();}catch(e){break;}if((s&0x1FFFF)===0){if(rcp.f3dTaskCount>=3)break;if(Date.now()-t0>40000)break;}}
realLog('LOADBLOCK targets:',JSON.stringify(blk));
realLog('LOADTILE targets:',JSON.stringify(til));
