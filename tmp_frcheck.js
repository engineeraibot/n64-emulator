const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState('state_adv2', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
let sOdd=0,sTot=0,dOdd=0,dTot=0;
const orig=cpu.opCOP1.bind(cpu);
cpu.opCOP1=function(i,pc,ds){
  const sub=(i>>21)&0x1F,rt=(i>>16)&0x1F,fs=(i>>11)&0x1F,fd=(i>>6)&0x1F,f=i&0x3F;
  if(sub===0x10){sTot++; if((fs&1)||(rt&1)||(fd&1))sOdd++;}
  else if(sub===0x11){dTot++; if((fs&1)||(rt&1)||(fd&1))dOdd++;}
  return orig(i,pc,ds);
};
const t0=Date.now();
for(let s=0;;s++){try{cpu.step();}catch(e){break;}
  if((s&0xFFFF)===0){if((rcp.f3dTaskCount|0)>=4)break;if(Date.now()-t0>40000)break;}}
realLog('f3d',rcp.f3dTaskCount|0);
realLog('S-fmt arith:',sTot,'oddReg:',sOdd);
realLog('D-fmt arith:',dTot,'oddReg:',dOdd);
