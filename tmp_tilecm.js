const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console); console.log=()=>{};
const STOPF3D=parseInt(process.env.STOPF3D||'3',10);
rcp.f3dTaskCount=0;
const seen={};
const orig=rcp.handleG_SETTILE.bind(rcp);
rcp.handleG_SETTILE=function(hi,lo){orig(hi,lo);
  const t=(lo>>24)&0x7;const cmS=(lo>>8)&3,cmT=(lo>>18)&3,maskS=(lo>>4)&0xF,maskT=(lo>>14)&0xF;
  const k='t'+t+' cmS='+cmS+' cmT='+cmT+' maskS='+maskS+' maskT='+maskT+' fmt='+((hi>>21)&7)+' sz='+((hi>>19)&3);
  seen[k]=(seen[k]||0)+1;};
const t0=Date.now();
for(let s=0;;s++){try{cpu.step();}catch(e){break;}
  if((s&0x1FFFF)===0){if((rcp.f3dTaskCount|0)>=STOPF3D)break;if(Date.now()-t0>40000)break;}}
for(const k of Object.keys(seen).sort((a,b)=>seen[b]-seen[a]))realLog(seen[k],k);
