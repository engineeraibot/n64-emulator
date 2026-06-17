// Teleport Mario: set gMarioState->pos, vel, gMarioObject gfx.pos & oPos. Then idle and save.
const {buildMachine}=require('./tmp_boot');
const {loadState,saveState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.IN, ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
const dv=ram.rdramView;
const MS=0x309430;           // gMarioState (pos at +0x3C = 0x30946c)
const MOBJ=0x313f38;         // gMarioObject base (gfx.pos +0x20)
const X=parseFloat(process.env.X),Y=parseFloat(process.env.Y),Z=parseFloat(process.env.Z);
function set3(off,x,y,z){dv.setFloat32(off,x,false);dv.setFloat32(off+4,y,false);dv.setFloat32(off+8,z,false);}
set3(0x30946c,X,Y,Z);           // ms->pos
const VX=parseFloat(process.env.VX||'0'),VY=parseFloat(process.env.VY||'0'),VZ=parseFloat(process.env.VZ||'0');
set3(0x309478,VX,VY,VZ);        // ms->vel
dv.setFloat32(0x309484,0,false);// ms->forwardVel
set3(MOBJ+0x20,X,Y,Z);          // gfx.pos
set3(MOBJ+0xA0,X,Y,Z);          // oPosX/Y/Z
if(process.env.YAW!==undefined){const yaw=parseInt(process.env.YAW,10)&0xFFFF;
  dv.setUint16(0x309456,yaw,false);      // ms->faceAngle[1]
  dv.setUint16(MOBJ+0x1C,yaw,false);     // gfx.angle yaw
}
const N=parseInt(process.env.N||'3000000',10);
mmu.updateController(0,0,0);
for(let i=0;i<N;i++){try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
  if((i&0x3FFFF)===0)mmu.updateController(0,0,0);}
const p=[dv.getFloat32(0x30946c),dv.getFloat32(0x309470),dv.getFloat32(0x309474)];
saveState(process.env.OUT, ram, mmu, cpu, rcp);
realLog('SAVED',process.env.OUT,'pos',p.map(v=>v.toFixed(0)).join(','));
