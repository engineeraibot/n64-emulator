const fs=require('fs'),zlib=require('zlib');
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_advfix1', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
const NOTEX=process.env.NOTEX==='1';
const origRast=rcp.rasterizeTriangle.bind(rcp);
rcp.rasterizeTriangle=function(v1,v2,v3,addr){ if(NOTEX)rcp.rspState.useTexture=false; return origRast(v1,v2,v3,addr); };
rcp.f3dTaskCount=0;
const t0=Date.now();
for(let s=0;;s++){ try{cpu.step();}catch(e){break;}
  if((s&0x1FFFF)===0){ if((rcp.f3dTaskCount|0)>=3)break; if(Date.now()-t0>40000)break; } }
const snap=rcp.bestRichVideoSnapshot;
realLog('snap nonBlack='+snap.nonBlack);
function crc32(buf){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}let crc=0xFFFFFFFF;for(let n=0;n<buf.length;n++)crc=t[(crc^buf[n])&0xFF]^(crc>>>8);return (crc^0xFFFFFFFF)>>>0;}
function writePng(rgba,w,h,out){function chunk(ty,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(ty,'binary'),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b),0);return Buffer.concat([l,b,c]);}
 const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
 const stride=w*4;const raw=Buffer.alloc((stride+1)*h);for(let y=0;y<h;y++){raw[y*(stride+1)]=0;rgba.copy(raw,y*(stride+1)+1,y*stride,(y+1)*stride);}
 fs.writeFileSync(out,Buffer.concat([sig,chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));}
const d=snap.data,W=320,H=240,rgba=Buffer.alloc(W*H*4);let p=0;
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*2;const v=(d[i]<<8)|d[i+1];rgba[p++]=((v>>11)&31)<<3;rgba[p++]=((v>>6)&31)<<3;rgba[p++]=((v>>1)&31)<<3;rgba[p++]=255;}
writePng(rgba,W,H,process.env.OUT||'test-results/notex.png');
realLog('wrote',process.env.OUT);
