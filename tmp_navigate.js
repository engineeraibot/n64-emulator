// Generic menu navigation: run a timed controller sequence from a state, save result.
// SEQ format: JSON array of [steps, buttons, stickX, stickY]
// e.g. SEQ='[[2000000,0,0,0],[2000000,4096,0,0],[8000000,0,0,0]]'
const {buildMachine}=require('./tmp_boot');
const {loadState,saveState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const IN=process.env.IN||'state_chain2', OUT=process.env.OUT||'state_nav1';
const SEQ=JSON.parse(process.env.SEQ||'[[2000000,0,0,0],[2000000,4096,0,0],[10000000,0,0,0]]');
loadState(IN, ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
const t0=Date.now();let s=0;
for(const [n,btn,sx,sy] of SEQ){
  mmu.updateController(btn,sx,sy);
  realLog('phase btn=0x'+btn.toString(16),'stick',sx,sy,'steps',n,'f3d',rcp.f3dTaskCount|0);
  for(let i=0;i<n;i++,s++){
    try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
    if((i&0x3FFFF)===0){mmu.updateController(btn,sx,sy);
      if(Date.now()-t0>40000){realLog('TIME BUDGET');break;}}
  }
  if(Date.now()-t0>40000)break;
}
saveState(OUT, ram, mmu, cpu, rcp);
realLog('SAVED',OUT,'steps',s,'f3d',rcp.f3dTaskCount|0);
