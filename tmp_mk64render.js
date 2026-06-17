process.env.ROM = process.env.ROM || 'Mario Kart 64 (Europe) (Rev A).n64';
const fs=require('fs'),zlib=require('zlib');
const {buildMachine}=require('./tmp_boot');
const {ram,mmu,rcp,cpu}=buildMachine();
const log=console.error.bind(console);
const STOP=parseInt(process.env.STOPF3D||'150',10);
const PRESS=process.env.PRESS||'';
const t0=Date.now();
let pressed=false;
for(let s=0;s<300000000;s++){
  try{cpu.step();}catch(e){log('THREW',s,e.message);break;}
  if((s&0x3FFF)===0){
    const f=rcp.f3dTaskCount|0;
    if(PRESS && !pressed){const a=PRESS.split(':');if(f>=parseInt(a[0])){mmu.updateController(parseInt(a[1]),0,0);pressed=true;log('pressed',a[1],'at f3d',f);}}
    if(f>=STOP){log('reached f3d',f,'step',s);break;}
    if(Date.now()-t0>38000){log('[budget]',s,'f3d',f);break;}
  }
}
const rd=new Uint8Array(mmu.memory.rdram);
function scanRegion(origin,w,h,type){
  let nb=0;const bpp=type===3?4:2;
  for(let i=0;i<w*h;i++){const o=(origin+i*bpp);
    if(type===2){const v=(rd[o]<<8)|rd[o+1];const r=((v>>11)&31),g=((v>>6)&31),b=((v>>1)&31);if(r>1||g>1||b>1)nb++;}
    else{if(rd[o]>12||rd[o+1]>12||rd[o+2]>12)nb++;}
  }
  return nb;
}
let ci=rcp.rspState.colorImage>>>0;
const viOrigin=((mmu.viRegisters?mmu.viRegisters[1]:0)>>>0)&0x7FFFFF;
log('colorImage=0x'+ci.toString(16),'w',rcp.rspState.colorImageWidth,'size',rcp.rspState.colorImageSize);
log('VI origin=0x'+viOrigin.toString(16),'scan16 nb='+scanRegion(viOrigin,320,240,2));
let bestO=0,bestN=0;
for(let o=0x100000;o<0x7d0000;o+=0x800){const nb=scanRegion(o,320,240,2);if(nb>bestN){bestN=nb;bestO=o;}}
log('richest 16-bit fb: origin=0x'+bestO.toString(16)+' nb='+bestN);
if(process.env.USEVI)ci=viOrigin;
if(process.env.USEBEST)ci=bestO;
function crc32(buf){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}let crc=0xFFFFFFFF;for(let n=0;n<buf.length;n++)crc=t[(crc^buf[n])&0xFF]^(crc>>>8);return (crc^0xFFFFFFFF)>>>0;}
function writePng(rgba,w,h,out){function chunk(ty,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(ty,'binary'),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b),0);return Buffer.concat([l,b,c]);}
 const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
 const stride=w*4;const raw=Buffer.alloc((stride+1)*h);for(let y=0;y<h;y++){raw[y*(stride+1)]=0;rgba.copy(raw,y*(stride+1)+1,y*stride,(y+1)*stride);}
 fs.writeFileSync(out,Buffer.concat([sig,chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));}
const W=320,H=240;const out=Buffer.alloc(W*H*4);let p=0;
for(let i=0;i<W*H;i++){const o=ci+i*2;const v=(rd[o]<<8)|rd[o+1];out[p++]=((v>>11)&31)<<3;out[p++]=((v>>6)&31)<<3;out[p++]=((v>>1)&31)<<3;out[p++]=255;}
const OUT=process.env.OUT_PNG||'test-results/mk64.png';fs.mkdirSync('test-results',{recursive:true});writePng(out,W,H,OUT);log('wrote',OUT,'ci=0x'+ci.toString(16));
