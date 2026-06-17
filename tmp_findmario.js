// Find Mario pos: float triplets that differ between two states, plausible coords
const fs=require('fs');
const a=fs.readFileSync(process.env.A||'state_lobbyG.rdram');
const b=fs.readFileSync(process.env.B||'state_lobbyI.rdram');
function f32(buf,off){return buf.readFloatBE(off);}
const cands=[];
for(let off=0;off<a.length-12;off+=4){
  const ax=f32(a,off),ay=f32(a,off+4),az=f32(a,off+8);
  const bx=f32(b,off),by=f32(b,off+4),bz=f32(b,off+8);
  if(!isFinite(ax)||!isFinite(bx)||!isFinite(ay)||!isFinite(by)||!isFinite(az)||!isFinite(bz))continue;
  const mag=v=>Math.abs(v)<20000&&Math.abs(v)>0.5;
  if(mag(ax)&&mag(az)&&mag(bx)&&mag(bz)&&Math.abs(ay)<20000&&Math.abs(by)<20000){
    const dx=bx-ax,dy=by-ay,dz=bz-az;const d=Math.hypot(dx,dy,dz);
    if(d>50&&d<3000 && (ax!==bx||az!==bz)){cands.push([off,ax,ay,az,bx,by,bz,d]);}
  }
}
console.log('cands',cands.length);
for(const c of cands.slice(0,200))console.log('0x'+(0x80000000+c[0]).toString(16),c.slice(1).map(v=>v.toFixed(1)).join(' '));
