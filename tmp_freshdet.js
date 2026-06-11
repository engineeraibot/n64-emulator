const fs=require('fs'),zlib=require('zlib');
const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
const realLog=console.log.bind(console);
global.console={log:()=>{},warn:()=>{},error:()=>{}};
const t0=Date.now();
for(let s=0;;s++){cpu.step(); if((s&0xFFFF)===0){if((rcp.f3dTaskCount|0)>=96)break; if(Date.now()-t0>60000)break;}}
const vo=mmu.viRegisters[1]&0x7FFFFF,vw=mmu.viRegisters[2]&0xFFF,vt=mmu.viRegisters[0]&0x3;
const sel=rcp.getDeterministicVideoTarget(vo,vw,vt);
realLog('f3d',rcp.f3dTaskCount|0,'VI_ORIGIN=0x'+vo.toString(16),'DET src='+(sel&&sel.source),'origin=0x'+(sel?sel.origin.toString(16):'?'),'snapshot='+!!(sel&&sel.snapshot));
const W=320,H=240;
let getPix; // returns [r,g,b] for x,y
if(sel&&sel.snapshot&&sel.data){const d=sel.data,bpp=sel.type===3?4:2,w=sel.width;getPix=(x,y)=>{const i=(y*w+x)*bpp;if(sel.type===2){const v=(d[i]<<8)|d[i+1];return[((v>>11)&31)<<3,((v>>6)&31)<<3,((v>>1)&31)<<3];}return[d[i],d[i+1],d[i+2]];};}
else{const src=new Uint8Array(mmu.memory.rdram),o=(sel?sel.origin:vo)&0x7FFFFF;getPix=(x,y)=>{const a=(o+(y*W+x)*2)&0x7FFFFF;const v=(src[a]<<8)|src[a+1];return[((v>>11)&31)<<3,((v>>6)&31)<<3,((v>>1)&31)<<3];};}
const rgba=Buffer.alloc(W*H*4);let nb=0;
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const[r,g,b]=getPix(x,y);const o=(y*W+x)*4;rgba[o]=r;rgba[o+1]=g;rgba[o+2]=b;rgba[o+3]=255;if(r>12||g>12||b>12)nb++;}
const ct=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;ct[n]=c>>>0;}
function crc(b){let c=0xffffffff;for(let i=0;i<b.length;i++)c=ct[(c^b[i])&0xff]^(c>>>8);return(c^0xffffffff)>>>0;}
function ch(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(b),0);return Buffer.concat([l,b,c]);}
const ih=Buffer.alloc(13);ih.writeUInt32BE(W,0);ih.writeUInt32BE(H,4);ih[8]=8;ih[9]=6;
const raw=Buffer.alloc(H*(W*4+1));for(let y=0;y<H;y++){raw[y*(W*4+1)]=0;rgba.copy(raw,y*(W*4+1)+1,y*W*4,(y+1)*W*4);}
fs.writeFileSync('test-results/sm64-det-fresh.png',Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]));
realLog('wrote test-results/sm64-det-fresh.png nb',nb);
