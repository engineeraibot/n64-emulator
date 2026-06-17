process.env.ROM="Mario Kart 64 (Europe) (Rev A).n64";
const {buildMachine}=require("./tmp_boot");
const {loadState}=require("./tmp_state");
const {ram,mmu,rcp,cpu}=buildMachine();
loadState("state_mk64_race",ram,mmu,cpu,rcp);
const log=console.error.bind(console);
const startF=rcp.f3dTaskCount|0, STOP=startF+2;
let auditOn=false, n4=0, hitBranch=0, totV=0;
const orig=rcp.handleG_VTX.bind(rcp);
rcp.handleG_VTX=function(hi,lo){
  if(auditOn){
    totV++;
    if(this.rspState.triIndexScale===2 && !this.rspState.isF3DEX2) hitBranch++;
    const num=((hi&0xFFFF)>>>10)&0x3F; if(num===4)n4++;
  }
  return orig(hi,lo);
};
for(let s=0;s<400000000;s++){
  try{cpu.step();}catch(e){log("THREW",e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dTaskCount|0;auditOn=(f>=STOP-1);if(f>=STOP)break;}
}
log("totVtxCmds",totV,"F3DEX1hits",hitBranch,"num4loads",n4,"triScale",rcp.rspState&&rcp.rspState.triIndexScale,"isEX2",rcp.rspState&&rcp.rspState.isF3DEX2);
