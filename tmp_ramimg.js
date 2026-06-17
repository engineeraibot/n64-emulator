// ROM= STATE= ADDR= W= H= OUT_PNG= — dump RDRAM as RGBA16 image.
const fs=require('fs'),zlib=require('zlib');
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE, ram, mmu, cpu, rcp);
const A=parseInt(process.env.ADDR,16)&0x7FFFFF, W=parseInt(process.env.W||'320'), H=parseInt(process.env.H||'240');
const b=new Uint8Array(ram.rdram);
const out=Buffer.alloc(W*H*4);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=A+(y*W+x)*2;const v=(b[i]<<8)|b[i+1];const p=(y*W+x)*4;
 out[p]=((v>>11)&31)<<3;out[p+1]=((v>>6)&31)<<3;out[p+2]=((v>>1)&31)<<3;out[p+3]=255;}
function crc32(buf){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}let crc=0xFFFFFFFF;for(let n=0;n<buf.length;n++)crc=t[(crc^buf[n])&0xFF]^(crc>>>8);return(crc^0xFFFFFFFF)>>>0;}
function ch(ty,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const bb=Buffer.concat([Buffer.from(ty),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(bb),0);return Buffer.concat([l,bb,c]);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=6;
const st=W*4;const raw=Buffer.alloc((st+1)*H);for(let y=0;y<H;y++){out.copy(raw,y*(st+1)+1,y*st,(y+1)*st);}
fs.writeFileSync(process.env.OUT_PNG||'test-results/ramimg.png',Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ihdr),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]));
console.error('wrote');
