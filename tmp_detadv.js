const {buildMachine}=require('./tmp_boot');
const {loadState,saveState}=require('./tmp_state');
const zlib=require('zlib');const fs=require('fs');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState('state_title_full', ram, mmu, cpu, rcp);
const realLog=console.log; global.console={log:()=>{},warn:()=>{},error:()=>{}};
const N=parseInt(process.env.N||'50000000',10);
const t0=Date.now();
for(let i=0;i<N;i++){cpu.step(); if((rcp.f3dTaskCount|0)>=96) break;}
realLog('f3d',rcp.f3dTaskCount|0,'time',((Date.now()-t0)/1000).toFixed(1)+'s');
const W=320,H=240;
const vo=mmu.viRegisters[1]&0x7FFFFF, vw=mmu.viRegisters[2]&0xFFF, vt=mmu.viRegisters[0]&0x3;
const sel=rcp.getDeterministicVideoTarget(vo,vw,vt);
const br=rcp.bestRichVideoSnapshot;
realLog('VI_ORIGIN=0x'+vo.toString(16),'det pick=0x'+(sel?sel.origin.toString(16):'?'),'src='+(sel&&sel.source),'| bestRich origin=0x'+(br?br.origin.toString(16):'?'),'nb='+(br?br.nonBlack:'-'));
const src=new Uint8Array(mmu.memory.rdram);
function render(origin,out){const rgba=Buffer.alloc(W*H*4);let nb=0;for(let y=0;y<H;y++)for(let x=0;x<W;x++){const a=(origin+(y*W+x)*2)&0x7FFFFF;const v=(src[a]<<8)|src[a+1];const r=((v>>11)&31)<<3,g=((v>>6)&31)<<3,b=((v>>1)&31)<<3;const o=(y*W+x)*4;rgba[o]=r;rgba[o+1]=g;rgba[o+2]=b;rgba[o+3]=255;if(r>12||g>12||b>12)nb++;}
const ct=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;ct[n]=c>>>0;}
function crc(b){let c=0xffffffff;for(let i=0;i<b.length;i++)c=ct[(c^b[i])&0xff]^(c>>>8);return(c^0xffffffff)>>>0;}
function ch(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(b),0);return Buffer.concat([l,b,c]);}
const ih=Buffer.alloc(13);ih.writeUInt32BE(W,0);ih.writeUInt32BE(H,4);ih[8]=8;ih[9]=6;
const raw=Buffer.alloc(H*(W*4+1));for(let y=0;y<H;y++){raw[y*(W*4+1)]=0;rgba.copy(raw,y*(W*4+1)+1,y*W*4,(y+1)*W*4);}
fs.writeFileSync(out,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]));realLog('wrote',out,'nb',nb);}
if(sel) render(sel.origin,'test-results/sm64-det-title96.png');
saveState('state_title96', ram, mmu, cpu, rcp);
