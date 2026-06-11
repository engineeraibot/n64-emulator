const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState('state_fileselect', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
rcp.f3dTaskCount=0;
let auditOn=false;
const origST=rcp.handleG_SETTILE.bind(rcp);
const seen=new Set();
rcp.handleG_SETTILE=function(hi,lo){
  if(auditOn){
    const k=(hi>>>0).toString(16)+'_'+(lo>>>0).toString(16);
    if(!seen.has(k)){seen.add(k);
      realLog('SETTILE hi=0x'+(hi>>>0).toString(16),'lo=0x'+(lo>>>0).toString(16),
        'tile',(lo>>24)&7,'fmt',(hi>>21)&7,'siz',(hi>>19)&3,'line',(hi>>9)&0x1FF,'tmem',hi&0x1FF,
        'cmT',(lo>>18)&3,'maskT',(lo>>14)&0xF,'shiftT',(lo>>10)&0xF,
        'cmS',(lo>>8)&3,'maskS',(lo>>4)&0xF,'shiftS',lo&0xF);
    }
  }
  return origST(hi,lo);
};
const t0n=Date.now();
for(let s=0;;s++){
  try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((s&0xFFF)===0){const f=rcp.f3dTaskCount|0;auditOn=f>=2;
    if(f>=3||Date.now()-t0n>40000){realLog('done f3d',f);break;}}
}
