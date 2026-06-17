// Navigate with position telemetry. SEQ like tmp_navigate. Prints Mario pos per phase chunk.
const {buildMachine}=require('./tmp_boot');
const {loadState,saveState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
const IN=process.env.IN, OUT=process.env.OUT;
const SEQ=JSON.parse(process.env.SEQ);
loadState(IN, ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
const POS=0x30946c; // gMarioState->pos (phys offset)
function rd(off){return ram.rdramView.getFloat32(off,false);}
function pos(){return [rd(POS),rd(POS+4),rd(POS+8)];}
const t0=Date.now();let s=0;
for(const [n,btn,sx,sy] of SEQ){
  mmu.updateController(btn,sx,sy);
  for(let i=0;i<n;i++,s++){
    try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
    if((i&0x3FFFF)===0){mmu.updateController(btn,sx,sy);
      if(Date.now()-t0>38000){realLog('TIME BUDGET');break;}}
    if((i%2000000)===1999999){const p=pos();realLog('pos',p.map(v=>v.toFixed(0)).join(','),'btn=0x'+btn.toString(16),'stick',sx,sy);}
  }
  const p=pos();realLog('PHASE END pos',p.map(v=>v.toFixed(0)).join(','),'f3d',rcp.f3dTaskCount|0);
  if(Date.now()-t0>38000)break;
}
if(OUT)saveState(OUT, ram, mmu, cpu, rcp);
realLog('SAVED',OUT,'steps',s);
