const fs=require('fs');
const b=fs.readFileSync((process.env.STATE||'state_nv7')+'.rdram');
const f=o=>b.readFloatBE(o);const u16=o=>b.readUInt16BE(o);const u32=o=>b.readUInt32BE(o);
let best=null;
for(let base=0x313f38%0x260+0x2f0000- ((0x313f38)%0x260===((0x2f0000)%0x260)?0:0);0;){break;}
// brute: try all bases congruent to anchor mod 0x260 within plausible range
for(const anchor of [0x313f38,0x313fb8]){
 for(let k=0;k<300;k++){
  const base=anchor-k*0x260; if(base<0x200000)break;
  let good=0;
  for(let i=0;i<240;i++){const r=base+i*0x260; if(r+0x260>b.length)break;
    const af=u16(r+0x74); const x=f(r+0x20),z=f(r+0x28);
    if((af&1)&&isFinite(x)&&isFinite(z)&&Math.abs(x)<50000&&Math.abs(z)<50000)good++;}
  if(!best||good>=best.good)best={anchor,base,good};
 }
}
console.log('BEST base=0x'+(best.base+0x80000000).toString(16),'good',best.good,'anchor 0x'+(best.anchor+0x80000000).toString(16));
const base=best.base;
// dump active objects: pos + behavior ptr
const rows=[];
for(let i=0;i<240;i++){const r=base+i*0x260;if(r+0x260>b.length)break;
  const af=u16(r+0x74); if(!(af&1))continue;
  const x=f(r+0x20),y=f(r+0x24),z=f(r+0x28);
  const beh=u32(r+0x20C);
  rows.push([i,x,y,z,beh]);
}
const byBeh={};
for(const [i,x,y,z,beh] of rows){(byBeh[beh]=byBeh[beh]||[]).push([i,x,y,z]);}
for(const beh of Object.keys(byBeh)){
  const l=byBeh[beh];
  console.log('beh 0x'+(+beh>>>0).toString(16),'count',l.length);
  for(const [i,x,y,z] of l)console.log('   #'+i,x.toFixed(0),y.toFixed(0),z.toFixed(0));
}
