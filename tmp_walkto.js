// Auto-walk Mario to TX,TZ using movement-direction feedback.
const {buildMachine}=require('./tmp_boot');
const {loadState,saveState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.IN, ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
const POS=0x30946c;
const rd=o=>ram.rdramView.getFloat32(o,false);
const pos=()=>[rd(POS),rd(POS+4),rd(POS+8)];
const TX=parseFloat(process.env.TX), TZ=parseFloat(process.env.TZ);
const TOL=parseFloat(process.env.TOL||'120');
let ang=Math.PI/2; // stick angle: sx=cos,sy=sin... start = up
const t0=Date.now();let s=0;let last=pos();let lastAng=ang;
outer:
for(let chunk=0;chunk<60;chunk++){
  const p=pos();
  const dx=TX-p[0], dz=TZ-p[2]; const dist=Math.hypot(dx,dz);
  realLog('pos',p.map(v=>v.toFixed(0)).join(','),'dist',dist.toFixed(0));
  if(dist<TOL){realLog('ARRIVED');break;}
  // movement since last chunk:
  const mx=p[0]-last[0], mz=p[2]-last[2];
  if(Math.hypot(mx,mz)>40){
    const moveAng=Math.atan2(-mz,mx); // world angle of motion (use -z as "north")
    const wantAng=Math.atan2(-dz,dx);
    ang=lastAng+(wantAng-moveAng); // correct stick by error
  }
  last=p; lastAng=ang;
  const sx=Math.round(70*Math.cos(ang)), sy=Math.round(70*Math.sin(ang));
  mmu.updateController(0,sx,sy);
  for(let i=0;i<1200000;i++,s++){
    try{cpu.step();}catch(e){realLog('THREW',e.message);break outer;}
    if((i&0x3FFFF)===0){mmu.updateController(0,sx,sy);if(Date.now()-t0>38000){realLog('BUDGET');break outer;}}
  }
}
mmu.updateController(0,0,0);
for(let i=0;i<400000;i++)cpu.step();
saveState(process.env.OUT, ram, mmu, cpu, rcp);
realLog('SAVED',process.env.OUT,'steps',s,'pos',pos().map(v=>v.toFixed(0)).join(','));
