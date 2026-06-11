// Dump sampled texel grid for selected texrects (file-select label glyphs).
const fs=require('fs'),zlib=require('zlib');
const {buildMachine}=require('./tmp_boot');
const {loadState}=require('./tmp_state');
const {ram,mmu,rcp,cpu}=buildMachine();
loadState(process.env.STATE||'state_fileselect', ram, mmu, cpu, rcp);
const realLog=console.log.bind(console);
function crc32(b){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}let crc=0xFFFFFFFF;for(let n=0;n<b.length;n++)crc=t[(crc^b[n])&0xFF]^(crc>>>8);return(crc^0xFFFFFFFF)>>>0;}
function writePng(rgba,w,h,out){function ch(ty,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(ty),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b),0);return Buffer.concat([l,b,c]);}
 const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
 const st=w*4;const raw=Buffer.alloc((st+1)*h);for(let y=0;y<h;y++){raw[y*(st+1)]=0;rgba.copy(raw,y*(st+1)+1,y*st,(y+1)*st);}
 fs.writeFileSync(out,Buffer.concat([sig,ch('IHDR',ihdr),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]));}
rcp.f3dTaskCount=0;
const STOPF3D=parseInt(process.env.STOPF3D||'3',10);
const ROWY=parseInt(process.env.ROWY||'152',10);
let auditOn=false, idx=0, dumped=0;
const orig=rcp.handleG_TEXRECT.bind(rcp);
rcp.handleG_TEXRECT=function(hi,lo,addr,flip,isRdpFifo){
  if(auditOn){
    const rs=this.rspState;
    const xh=(hi>>12)&0xFFF, tileN=(lo>>24)&7, xl=(lo>>12)&0xFFF, yl=lo&0xFFF;
    if((yl>>2)===ROWY && dumped<4){
      const w1lo=this.mmu.read32(Number(addr)+12),w2lo=this.mmu.read32(Number(addr)+20);
      const s0=w1lo>>16,t0=(w1lo<<16)>>16,dsdx=w2lo>>16,dtdy=(w2lo<<16)>>16;
      const tile=rs.tiles[tileN];
      realLog(`rect#${idx} x=${xl>>2}..${xh>>2} s0=${s0/32} t0=${t0/32} dsdx=${dsdx} dtdy=${dtdy} flip=${flip} fmt${tile.format} sz${tile.size} line${tile.line} tmem${tile.tmem} sl${tile.sl} tl${tile.tl} sh${tile.sh} th${tile.th} cmS${tile.cmS} cmT${tile.cmT} maskS${tile.maskS} maskT${tile.maskT} texImg=0x${(rs.textureImage>>>0).toString(16)}`);
      const SC=16,TW=16,TH=8,W=TW*SC,H=TH*SC;const buf=Buffer.alloc(W*H*4);
      for(let py=0;py<H;py++)for(let px=0;px<W;px++){
        const c=this.sampleTexture(Math.floor(px/SC)*32,Math.floor(py/SC)*32,tileN,true);
        const o=(py*W+px)*4;buf[o]=c.r;buf[o+1]=c.g;buf[o+2]=c.b;buf[o+3]=255;
      }
      writePng(buf,W,H,`test-results/rectdump-${dumped}.png`);
      dumped++;
    }
    idx++;
  }
  return orig(hi,lo,addr,flip,isRdpFifo);
};
const t0n=Date.now();
for(let s=0;;s++){
  try{cpu.step();}catch(e){realLog('THREW',s,e.message);break;}
  if((s&0xFFF)===0){
    const f=rcp.f3dTaskCount|0;
    auditOn=f>=STOPF3D-1;
    if(f>=STOPF3D||Date.now()-t0n>40000){realLog('done f3d',f);break;}
  }
}
