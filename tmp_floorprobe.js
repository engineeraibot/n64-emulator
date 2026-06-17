// Probe floors: for a grid of (x,z), teleport high and report Mario's y after falling.
const {buildMachine}=require('./tmp_boot');
const {loadState,saveState}=require('./tmp_state');
const fs=require('fs');
const {ram,mmu,rcp,cpu}=buildMachine();
const realLog=console.log.bind(console);
const dv=()=>ram.rdramView;
const MOBJ=0x313f38;
function set3(off,x,y,z){const d=ram.rdramView;d.setFloat32(off,x,false);d.setFloat32(off+4,y,false);d.setFloat32(off+8,z,false);}
const pts=JSON.parse(process.env.PTS); // [[x,y0,z],...]
for(const [X,Y0,Z] of pts){
  const {loadState}=require('./tmp_state');
  loadState(process.env.IN, ram, mmu, cpu, rcp);
  set3(0x30946c,X,Y0,Z);set3(0x309478,0,0,0);ram.rdramView.setFloat32(0x309484,0,false);
  set3(MOBJ+0x20,X,Y0,Z);set3(MOBJ+0xA0,X,Y0,Z);
  mmu.updateController(0,0,0);
  for(let i=0;i<2500000;i++){try{cpu.step();}catch(e){realLog('THREW',e.message);break;}
    if((i&0x3FFFF)===0)mmu.updateController(0,0,0);}
  const d=ram.rdramView;
  realLog('probe',X,Z,'-> y',d.getFloat32(0x30946c,false).toFixed(0),d.getFloat32(0x309470,false).toFixed(0),d.getFloat32(0x309474,false).toFixed(0));
}
