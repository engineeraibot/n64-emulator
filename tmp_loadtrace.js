const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE, ram, mmu, cpu, rcp);
const log=console.error.bind(console);
rcp.f3dTaskCount=0;
const STOPF3D=parseInt(process.env.STOPF3D||'2',10);
const hx=v=>'0x'+(v>>>0).toString(16);
const wrap=(name,extra)=>{const orig=rcp[name].bind(rcp);rcp[name]=(hi,lo)=>{
  if((rcp.f3dTaskCount|0)===STOPF3D-1){
    const st=rcp.rspState||{};
    log(name+' hi='+hx(hi)+' lo='+hx(lo)+' timg='+hx(st.textureImage||0)+' timgW='+(st.textureImageWidth|0)+' timgSiz='+(st.textureImageSize|0));
  }
  return orig(hi,lo);};};
for(const n of ['handleG_SETTILE','handleG_LOADBLOCK','handleG_LOADTILE','handleG_LOADTLUT'])wrap(n);
const t0=Date.now();
for(let s=0;;s++){
  try{cpu.step();}catch(e){log('THREW '+e.message);break;}
  if((s&0xFFFF)===0){if((rcp.f3dTaskCount|0)>=STOPF3D)break;if(Date.now()-t0>38000){log('budget');break;}}
}
