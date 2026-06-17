const fs=require('fs');
const b=fs.readFileSync((process.env.STATE||'state_nv7')+'.rdram');
const f=o=>b.readFloatBE(o);
// find Mario object: gfx.pos floats equal to gMarioState pos
const mx=f(0x30946c),my=f(0x309470),mz=f(0x309474);
console.log('mario',mx,my,mz);
const hits=[];
for(let o=0;o<b.length-12;o+=4){
  if(Math.abs(f(o)-mx)<0.01&&Math.abs(f(o+4)-my)<0.01&&Math.abs(f(o+8)-mz)<0.01)hits.push(o);
}
console.log('hits',hits.map(h=>'0x'+(h+0x80000000).toString(16)));
