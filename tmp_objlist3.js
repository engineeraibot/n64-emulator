const fs=require('fs');
const b=fs.readFileSync((process.env.STATE||'state_nv7')+'.rdram');
const f=o=>b.readFloatBE(o);const u16=o=>b.readUInt16BE(o);const u32=o=>b.readUInt32BE(o);
const M=0x313f38; // mario object base (gfx.pos at +0x20)
for(let n=-120;n<=120;n++){
  const r=M+n*0x260; if(r<0||r+0x260>b.length)continue;
  const af=u16(r+0x74);
  if(af===0||af===0xffff)continue;
  const x=f(r+0x20),y=f(r+0x24),z=f(r+0x28);
  if(!isFinite(x)||!isFinite(y)||!isFinite(z))continue;
  if(Math.abs(x)>20000||Math.abs(y)>20000||Math.abs(z)>20000)continue;
  const beh=u32(r+0x20C);
  console.log(n, 'af=0x'+af.toString(16), x.toFixed(0), y.toFixed(0), z.toFixed(0), 'beh=0x'+beh.toString(16));
}
