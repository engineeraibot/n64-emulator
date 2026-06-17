const fs=require('fs');
const b=fs.readFileSync((process.env.STATE||'state_nv7')+'.rdram');
const f=o=>b.readFloatBE(o);const u16=o=>b.readUInt16BE(o);const u32=o=>b.readUInt32BE(o);
for(const anchor of [0x313f38,0x313fb8]){
  for(let k=0;k<60;k++){
    const base=anchor-k*0x260; if(base<0)break;
    // heuristic: count records with activeFlags at +0x74 in {0x0000..0x3fff} and finite pos
    let good=0;
    for(let i=0;i<100;i++){const r=base+i*0x260; if(r+0x260>b.length)break;
      const af=u16(r+0x74); const x=f(r+0x20),y=f(r+0x24),z=f(r+0x28);
      if((af&1)&&isFinite(x)&&isFinite(y)&&isFinite(z)&&Math.abs(x)<50000&&Math.abs(z)<50000)good++;}
    if(good>20){console.log('base 0x'+(base+0x80000000).toString(16),'k',k,'good',good);}
  }
}
