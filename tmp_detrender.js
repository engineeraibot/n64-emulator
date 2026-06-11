const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const zlib=require('zlib');const fs=require('fs');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_title_full', ram, mmu, cpu, rcp);
const realLog=console.log; global.console={log:()=>{},warn:()=>{},error:()=>{}};
for(let i=0;i<parseInt(process.env.N||'8000000',10);i++) cpu.step();
const W=320,H=240;
const vo=mmu.viRegisters[1]&0x7FFFFF, vw=mmu.viRegisters[2]&0xFFF, vt=mmu.viRegisters[0]&0x3;
const sel=rcp.getDeterministicVideoTarget(vo,vw,vt);
realLog('det target origin=0x'+(sel?sel.origin.toString(16):'?')+' source='+(sel&&sel.source));
const src=new Uint8Array(mmu.memory.rdram);
const origin=(sel?sel.origin:vo)&0x7FFFFF;
const rgba=Buffer.alloc(W*H*4); let nb=0;
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const a=(origin+(y*W+x)*2)&0x7FFFFF;const v=(src[a]<<8)|src[a+1];const r=((v>>11)&31)<<3,g=((v>>6)&31)<<3,b=((v>>1)&31)<<3;const o=(y*W+x)*4;rgba[o]=r;rgba[o+1]=g;rgba[o+2]=b;rgba[o+3]=255;if(r>12||g>12||b>12)nb++;}
// crc table
const ct=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;ct[n]=c>>>0;}
function crc(b){let c=0xffffffff;for(let i=0;i<b.length;i++)c=ct[(c^b[i])&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(b),0);return Buffer.concat([l,b,c]);}
const ih=Buffer.alloc(13);ih.writeUInt32BE(W,0);ih.writeUInt32BE(H,4);ih[8]=8;ih[9]=6;
const raw=Buffer.alloc(H*(W*4+1));for(let y=0;y<H;y++){raw[y*(W*4+1)]=0;rgba.copy(raw,y*(W*4+1)+1,y*W*4,(y+1)*W*4);}
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
const out=process.env.OUT||'test-results/sm64-det-viorigin.png';
fs.writeFileSync(out,png);realLog('wrote',out,'nonBlack',nb);
