process.env.ROM='Mario Kart 64 (Europe) (Rev A).n64';
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState('state_mk64_race', ram, mmu, cpu, rcp);
const log=console.error.bind(console);
const startF=rcp.f3dTaskCount|0; const STOP=startF+2;
let branch1=0, branchF3D=0, branchEX2=0, total=0;
const orig=rcp.handleG_VTX.bind(rcp);
let auditOn=false;
rcp.handleG_VTX=function(hi,lo){
  if(auditOn){total++;
    if(this.rspState.isF3DEX2)branchEX2++;
    else if(this.rspState.triIndexScale===2)branch1++;
    else branchF3D++;
  }
  return orig(hi,lo);
};
for(let s=0;s<400000000;s++){try{cpu.step();}catch(e){log('THREW',e.message);break;}
  if((s&0x3FFF)===0){const f=rcp.f3dTaskCount|0; auditOn=(f>=STOP-1); if(f>=STOP)break;}}
log('ucodeName',rcp.rspState.ucodeName,'triIndexScale',rcp.rspState.triIndexScale,'isF3DEX2',rcp.rspState.isF3DEX2);
log('G_VTX total',total,'F3DEX1-branch',branch1,'F3D-branch',branchF3D,'EX2-branch',branchEX2);
