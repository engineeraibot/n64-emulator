// Walk toward TX,TZ (may be inside a wall); when stalled, release stick and press A (door open). Repeat.
const {buildMachine}=require('./tmp_boot');
const {loadState,saveState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.IN, ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
const POS=0x30946c;
const rd=o=>ram.rdramView.getFloat32(o,false);
const pos=()=>[rd(POS),rd(POS+4),rd(POS+8)];
const TX=parseFloat(process.env.TX), TZ=parseFloat(process.env.TZ);
let ang=Math.PI/2;
const t0=Date.now();let last=pos();let lastAng=ang;let aTries=0;
function run(n,btn,sx,sy){mmu.updateController(btn,sx,sy);
  for(let i=0;i<n;i++){try{cpu.step();}catch(e){realLog('THREW',e.message);return false;}
    if((i&0x3FFFF)===0){mmu.updateController(btn,sx,sy);if(Date.now()-t0>36000){realLog('BUDGET');return false;}}}
  return true;}
for(let chunk=0;chunk<40;chunk++){
  const p=pos();const dx=TX-p[0],dz=TZ-p[2];const dist=Math.hypot(dx,dz);
  const mx=p[0]-last[0],mz=p[2]-last[2];const moved=Math.hypot(mx,mz);
  realLog('pos',p.map(v=>v.toFixed(0)).join(','),'dist',dist.toFixed(0),'moved',moved.toFixed(0));
  if(moved>40){const moveAng=Math.atan2(-mz,mx),wantAng=Math.atan2(-dz,dx);ang=lastAng+(wantAng-moveAng);}
  else if(chunk>0){ // stalled: try A press standing still
    realLog('STALL -> A press',++aTries);
    if(!run(200000,0,0,0))break; if(!run(400000,0x8000,0,0))break; if(!run(2000000,0,0,0))break;
    const q=pos(); if(Math.hypot(q[0]-p[0],q[2]-p[2])>150){realLog('DOOR? big move after A');}
    if(aTries>=6)break;
    if(dist>250){ // far from target: back off to regain steering signal
      realLog('backoff');
      const bx=Math.round(70*Math.cos(ang+Math.PI)),by=Math.round(70*Math.sin(ang+Math.PI));
      if(!run(900000,0,bx,by))break;
    }
  }
  last=pos();lastAng=ang;
  const sx=Math.round(70*Math.cos(ang)),sy=Math.round(70*Math.sin(ang));
  if(!run(1200000,0,sx,sy))break;
}
mmu.updateController(0,0,0);for(let i=0;i<300000;i++)cpu.step();
saveState(process.env.OUT, ram, mmu, cpu, rcp);
realLog('SAVED',process.env.OUT,'pos',pos().map(v=>v.toFixed(0)).join(','));
